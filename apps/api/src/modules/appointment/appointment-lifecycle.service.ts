import { Inject, Injectable } from '@nestjs/common';

import {
  ACTIVE_APPOINTMENT_STATUSES,
  ACTIVE_HOLD_STATUS,
  createRepositories,
  DatabaseService,
  type Repositories,
} from '@vaidya/db';
import { AppError } from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import { NotificationOutboxService } from '../notification/notification-outbox.service';

@Injectable()
export class AppointmentLifecycleService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(DatabaseService) private readonly dbService: DatabaseService,
    @Inject(NotificationOutboxService) private readonly notificationOutbox: NotificationOutboxService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async confirmAppointment(input: {
    clinicId: string;
    appointmentId: string;
    actorUserId?: string;
  }) {
    const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
      input.clinicId,
      input.appointmentId,
    );
    if (!appointment) {
      throw new AppError('APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    }

    if (appointment.status !== 'pending_confirmation') {
      throw new AppError('APPOINTMENT_NOT_CONFIRMABLE', 'Only pending appointments can be confirmed.', {
        appointment_id: appointment.id,
        status: appointment.status,
      });
    }

    const [updated] = await this.repos.slots.updateAppointmentStatus(
      input.clinicId,
      appointment.id,
      'confirmed',
    );
    if (!updated) {
      throw new AppError('INTERNAL_ERROR', 'Failed to confirm appointment.');
    }

    await this.repos.appointmentLifecycle.insertAppointmentEvent({
      clinicId: input.clinicId,
      appointmentRequestId: appointment.id,
      eventType: 'appointment.confirmed',
      actorType: 'clinic_admin',
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      newValuesJson: { status: 'confirmed' },
      oldValuesJson: { status: appointment.status },
    });

    if (appointment.patientPhone) {
      await this.notificationOutbox.notifyPatientAppointmentConfirmed({
        clinicId: input.clinicId,
        appointmentId: appointment.id,
        patientPhone: appointment.patientPhone,
        payload: {
          appointment_start: appointment.appointmentStart,
        },
      });
    }

    return updated;
  }

  async cancelAppointment(input: {
    clinicId: string;
    appointmentId: string;
    actorUserId?: string;
  }) {
    const result = await this.dbService.withTransaction(async (tx) => {
      const [appointment] = await this.repos.appointmentLifecycle.findAppointmentByIdForUpdate(
        input.clinicId,
        input.appointmentId,
        tx,
      );
      if (!appointment) {
        throw new AppError('APPOINTMENT_NOT_FOUND', 'Appointment not found.');
      }

      if (appointment.status === 'cancelled') {
        return { changed: false as const, appointment };
      }

      if (
        !ACTIVE_APPOINTMENT_STATUSES.includes(
          appointment.status as 'pending_confirmation' | 'confirmed',
        )
      ) {
        throw new AppError('APPOINTMENT_NOT_CANCELLABLE', 'Appointment cannot be cancelled.', {
          appointment_id: appointment.id,
          status: appointment.status,
        });
      }

      const [updated] = await this.repos.slots.updateAppointmentStatus(
        input.clinicId,
        appointment.id,
        'cancelled',
        tx,
      );
      if (!updated) {
        throw new AppError('INTERNAL_ERROR', 'Failed to cancel appointment.');
      }

      await this.repos.appointmentLifecycle.rejectPendingActionRequestsForAppointment(
        input.clinicId,
        appointment.id,
        tx,
      );

      await this.repos.appointmentLifecycle.insertAppointmentEvent(
        {
          clinicId: input.clinicId,
          appointmentRequestId: appointment.id,
          eventType: 'appointment.cancelled',
          actorType: 'clinic_admin',
          ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
          newValuesJson: { status: 'cancelled' },
          oldValuesJson: { status: appointment.status },
        },
        tx,
      );

      return { changed: true as const, appointment: updated };
    });

    if (result.changed && result.appointment.patientPhone) {
      await this.notificationOutbox.notifyPatientAppointmentCancelled({
        clinicId: input.clinicId,
        appointmentId: result.appointment.id,
        patientPhone: result.appointment.patientPhone,
      });
    }

    return result.appointment;
  }

  async rescheduleAppointmentTime(input: {
    clinicId: string;
    appointmentId: string;
    newSlotId: string;
    actorUserId?: string;
    reservationSessionId?: string;
  }) {
    const result = await this.dbService.withSlotForUpdate(
      input.clinicId,
      input.newSlotId,
      async (slot, tx) => {
        const [appointment] = await this.repos.appointmentLifecycle.findAppointmentByIdForUpdate(
          input.clinicId,
          input.appointmentId,
          tx,
        );
        if (!appointment) {
          throw new AppError('APPOINTMENT_NOT_FOUND', 'Appointment not found.');
        }

        if (
          !ACTIVE_APPOINTMENT_STATUSES.includes(
            appointment.status as 'pending_confirmation' | 'confirmed',
          )
        ) {
          throw new AppError(
            'APPOINTMENT_NOT_CONFIRMABLE',
            'Cancelled appointments cannot be rescheduled.',
            {
              appointment_id: appointment.id,
              status: appointment.status,
            },
          );
        }

        if (slot.status !== 'open') {
          throw new AppError('SLOT_NOT_AVAILABLE', 'Selected slot is not available.');
        }

        const [sessionHold] = input.reservationSessionId
          ? await this.repos.slots.findActiveHoldForSession(
              input.clinicId,
              input.reservationSessionId,
              tx,
            )
          : [];
        const reservationHold = sessionHold?.slotId === slot.id ? sessionHold : undefined;

        // Saving the already-selected time is idempotent. Capacity-one slots are
        // intentionally absent from the availability list because this appointment
        // already occupies their only seat.
        if (appointment.slotId === slot.id) {
          if (sessionHold) {
            await this.repos.slots.updateHoldStatus(input.clinicId, sessionHold.id, 'released', tx);
          }
          return { changed: false as const, appointment };
        }

        if (
          slot.doctorId !== appointment.doctorId ||
          slot.clinicServiceId !== appointment.clinicServiceId
        ) {
          throw new AppError(
            'SLOT_NOT_AVAILABLE',
            'Selected slot does not match the appointment doctor and service.',
          );
        }

        const [holiday] = await this.repos.slots.isDoctorHolidayForWindow(
          input.clinicId,
          slot.doctorId,
          slot.startTime,
          slot.endTime,
          tx,
        );
        if (holiday) {
          throw new AppError('SLOT_NOT_AVAILABLE', 'Selected slot falls on doctor holiday.');
        }

        const load = await this.repos.slots.countSlotLoad(
          input.clinicId,
          slot.id,
          reservationHold ? { excludeHoldId: reservationHold.id } : {},
          tx,
        );
        if (load.activeAppointments + load.activeHolds >= slot.capacityTotal) {
          throw new AppError('SLOT_FULL', 'Slot is full for that time.', {
            slot_id: slot.id,
          });
        }

        if (appointment.slotHoldId && appointment.slotHoldId !== reservationHold?.id) {
          const [oldHold] = await this.repos.slots.findHoldById(
            input.clinicId,
            appointment.slotHoldId,
            tx,
          );
          if (oldHold?.status === ACTIVE_HOLD_STATUS) {
            await this.repos.slots.updateHoldStatus(input.clinicId, oldHold.id, 'released', tx);
          }
        }

        if (sessionHold && !reservationHold && sessionHold.id !== appointment.slotHoldId) {
          await this.repos.slots.updateHoldStatus(input.clinicId, sessionHold.id, 'released', tx);
        }

        const [updated] = await this.repos.slots.updateAppointmentSlotAndTime(
          input.clinicId,
          appointment.id,
          {
            slotId: slot.id,
            slotHoldId: reservationHold?.id ?? null,
            appointmentStart: slot.startTime,
            appointmentEnd: slot.endTime,
          },
          tx,
        );
        if (!updated) {
          throw new AppError('INTERNAL_ERROR', 'Failed to reschedule appointment.');
        }

        if (reservationHold) {
          await this.repos.slots.updateHoldStatus(
            input.clinicId,
            reservationHold.id,
            'converted',
            tx,
          );
        }

        await this.repos.appointmentLifecycle.insertAppointmentEvent(
          {
            clinicId: input.clinicId,
            appointmentRequestId: appointment.id,
            eventType: 'appointment.rescheduled',
            actorType: 'clinic_admin',
            ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
            ...(input.reservationSessionId ? { sourceSessionId: input.reservationSessionId } : {}),
            oldValuesJson: {
              slot_id: appointment.slotId,
              slot_hold_id: appointment.slotHoldId,
              appointment_start: appointment.appointmentStart,
              appointment_end: appointment.appointmentEnd,
            },
            newValuesJson: {
              slot_id: slot.id,
              slot_hold_id: reservationHold?.id ?? null,
              appointment_start: slot.startTime,
              appointment_end: slot.endTime,
            },
          },
          tx,
        );

        return { changed: true as const, appointment: updated };
      },
    );

    if (result.changed && result.appointment.patientPhone) {
      await this.notificationOutbox.notifyPatientAppointmentRescheduled({
        clinicId: input.clinicId,
        appointmentId: result.appointment.id,
        patientPhone: result.appointment.patientPhone,
        payload: {
          appointment_start: result.appointment.appointmentStart,
          appointment_end: result.appointment.appointmentEnd,
        },
      });
    }

    return result.appointment;
  }
}
