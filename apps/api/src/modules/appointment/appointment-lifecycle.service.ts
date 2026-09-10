import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import { ACTIVE_APPOINTMENT_STATUSES } from '@vaidya/db';
import { AppError } from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import { NotificationOutboxService } from '../notification/notification-outbox.service';

@Injectable()
export class AppointmentLifecycleService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
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
    const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
      input.clinicId,
      input.appointmentId,
    );
    if (!appointment) {
      throw new AppError('APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    }

    if (appointment.status === 'cancelled') {
      return appointment;
    }

    if (!ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status as 'pending_confirmation' | 'confirmed')) {
      throw new AppError('APPOINTMENT_NOT_CANCELLABLE', 'Appointment cannot be cancelled.', {
        appointment_id: appointment.id,
        status: appointment.status,
      });
    }

    const [updated] = await this.repos.slots.updateAppointmentStatus(
      input.clinicId,
      appointment.id,
      'cancelled',
    );
    if (!updated) {
      throw new AppError('INTERNAL_ERROR', 'Failed to cancel appointment.');
    }

    await this.repos.appointmentLifecycle.rejectPendingActionRequestsForAppointment(
      input.clinicId,
      appointment.id,
    );

    await this.repos.appointmentLifecycle.insertAppointmentEvent({
      clinicId: input.clinicId,
      appointmentRequestId: appointment.id,
      eventType: 'appointment.cancelled',
      actorType: 'clinic_admin',
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      newValuesJson: { status: 'cancelled' },
      oldValuesJson: { status: appointment.status },
    });

    if (appointment.patientPhone) {
      await this.notificationOutbox.notifyPatientAppointmentCancelled({
        clinicId: input.clinicId,
        appointmentId: appointment.id,
        patientPhone: appointment.patientPhone,
      });
    }

    return updated;
  }

  async rescheduleAppointmentTime(input: {
    clinicId: string;
    appointmentId: string;
    newSlotId: string;
    actorUserId?: string;
  }) {
    const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
      input.clinicId,
      input.appointmentId,
    );
    if (!appointment) {
      throw new AppError('APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    }

    if (!ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status as 'pending_confirmation' | 'confirmed')) {
      throw new AppError('APPOINTMENT_NOT_CONFIRMABLE', 'Cancelled appointments cannot be rescheduled.', {
        appointment_id: appointment.id,
        status: appointment.status,
      });
    }

    const [slot] = await this.repos.slots.findOpenSlot(input.clinicId, input.newSlotId);
    if (!slot) {
      throw new AppError('NOT_FOUND', 'Slot not found.');
    }

    const [holiday] = await this.repos.slots.isDoctorHolidayForWindow(
      input.clinicId,
      slot.doctorId,
      slot.startTime,
      slot.endTime,
    );
    if (holiday) {
      throw new AppError('SLOT_NOT_AVAILABLE', 'Selected slot falls on doctor holiday.');
    }

    const [updated] = await this.repos.slots.updateAppointmentSlotAndTime(
      input.clinicId,
      appointment.id,
      {
        slotId: slot.id,
        appointmentStart: slot.startTime,
        appointmentEnd: slot.endTime,
      },
    );
    if (!updated) {
      throw new AppError('INTERNAL_ERROR', 'Failed to reschedule appointment.');
    }

    await this.repos.appointmentLifecycle.insertAppointmentEvent({
      clinicId: input.clinicId,
      appointmentRequestId: appointment.id,
      eventType: 'appointment.rescheduled',
      actorType: 'clinic_admin',
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      oldValuesJson: {
        slot_id: appointment.slotId,
        appointment_start: appointment.appointmentStart,
        appointment_end: appointment.appointmentEnd,
      },
      newValuesJson: {
        slot_id: slot.id,
        appointment_start: slot.startTime,
        appointment_end: slot.endTime,
      },
    });

    if (updated.patientPhone) {
      await this.notificationOutbox.notifyPatientAppointmentRescheduled({
        clinicId: input.clinicId,
        appointmentId: updated.id,
        patientPhone: updated.patientPhone,
        payload: {
          appointment_start: updated.appointmentStart,
          appointment_end: updated.appointmentEnd,
        },
      });
    }

    return updated;
  }
}
