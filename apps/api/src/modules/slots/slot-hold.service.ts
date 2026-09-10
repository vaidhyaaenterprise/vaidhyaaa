import { Inject, Injectable } from '@nestjs/common';

import {
  ACTIVE_HOLD_STATUS,
  and,
  computeAvailableCount,
  createRepositories,
  DatabaseService,
  DEFAULT_HOLD_TTL_MS,
  eq,
  hasCapacityToConvertHold,
  slotHolds,
  type Repositories,
} from '@vaidya/db';
import { AppError } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

export type HoldSlotInput = {
  clinicId: string;
  slotId: string;
  sessionId?: string;
  patientPhone?: string;
};

@Injectable()
export class SlotHoldService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(DatabaseService) private readonly dbService: DatabaseService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async holdSlot(input: HoldSlotInput) {
    return this.dbService.withSlotForUpdate(input.clinicId, input.slotId, async (slot, tx) => {
      if (slot.status !== 'open') {
        throw new AppError('SLOT_NOT_AVAILABLE', 'Slot is not open for holds.', {
          clinic_id: input.clinicId,
          slot_id: input.slotId,
        });
      }

      const [holiday] = await this.repos.slots.isDoctorHolidayForWindow(
        input.clinicId,
        slot.doctorId,
        slot.startTime,
        slot.endTime,
        tx,
      );
      if (holiday) {
        throw new AppError('SLOT_NOT_AVAILABLE', 'Selected slot falls on doctor holiday.', {
          clinic_id: input.clinicId,
          slot_id: input.slotId,
        });
      }

      const load = await this.repos.slots.countSlotLoad(
        input.clinicId,
        input.slotId,
        {},
        tx,
      );
      const activeAppointments = load.activeAppointments;
      const activeHolds = load.activeHolds;
      const availableCount = computeAvailableCount({
        capacityTotal: slot.capacityTotal,
        activeAppointments,
        activeHolds,
      });

      if (availableCount <= 0) {
        throw new AppError('SLOT_FULL', 'Slot capacity is full.', {
          clinic_id: input.clinicId,
          slot_id: input.slotId,
        });
      }

      const holdExpiresAt = new Date(Date.now() + DEFAULT_HOLD_TTL_MS);

      if (input.sessionId) {
        const [existingHold] = await this.repos.slots.findLatestHoldForSession(
          input.clinicId,
          input.sessionId,
          tx,
        );
        if (existingHold) {
          const [hold] = await this.repos.slots.updateHold(
            input.clinicId,
            existingHold.id,
            {
              slotId: input.slotId,
              status: 'active',
              holdExpiresAt,
              ...(input.patientPhone ? { patientPhone: input.patientPhone } : {}),
            },
            tx,
          );
          if (!hold) {
            throw new AppError('INTERNAL_ERROR', 'Failed to refresh slot hold.');
          }
          return hold;
        }
      }

      const [hold] = await this.repos.slots.insertHold(
        {
          clinicId: input.clinicId,
          slotId: input.slotId,
          sessionId: input.sessionId ?? null,
          patientPhone: input.patientPhone ?? null,
          status: 'active',
          holdExpiresAt,
        },
        tx,
      );

      if (!hold) {
        throw new AppError('INTERNAL_ERROR', 'Failed to create slot hold.');
      }

      return hold;
    });
  }

  async holdSlotAndCreateAppointment(input: {
    clinicId: string;
    slotId: string;
    sessionId?: string;
    patientPhone?: string;
    patientId?: string | null;
    patientName: string;
    reasonForVisit: string;
    routingSource?: string | null;
    expectedDoctorId?: string;
  }) {
    return this.dbService.withSlotForUpdate(input.clinicId, input.slotId, async (slot, tx) => {
      if (slot.status !== 'open') {
        throw new AppError('SLOT_NOT_AVAILABLE', 'Slot is not open for holds.', {
          clinic_id: input.clinicId,
          slot_id: input.slotId,
        });
      }

      if (input.expectedDoctorId && slot.doctorId !== input.expectedDoctorId) {
        throw new AppError('SLOT_NOT_AVAILABLE', 'Slot does not belong to the selected doctor.', {
          clinic_id: input.clinicId,
          slot_id: input.slotId,
          doctor_id: input.expectedDoctorId,
        });
      }

      const [holiday] = await this.repos.slots.isDoctorHolidayForWindow(
        input.clinicId,
        slot.doctorId,
        slot.startTime,
        slot.endTime,
        tx,
      );
      if (holiday) {
        throw new AppError('SLOT_NOT_AVAILABLE', 'Selected slot falls on doctor holiday.', {
          clinic_id: input.clinicId,
          slot_id: input.slotId,
        });
      }

      const load = await this.repos.slots.countSlotLoad(
        input.clinicId,
        input.slotId,
        {},
        tx,
      );
      const activeAppointments = load.activeAppointments;
      const activeHolds = load.activeHolds;
      const availableCount = computeAvailableCount({
        capacityTotal: slot.capacityTotal,
        activeAppointments,
        activeHolds,
      });

      if (availableCount <= 0) {
        throw new AppError('SLOT_FULL', 'Slot capacity is full.', {
          clinic_id: input.clinicId,
          slot_id: input.slotId,
        });
      }

      const holdExpiresAt = new Date(Date.now() + DEFAULT_HOLD_TTL_MS);

      const [created] = await this.repos.slots.insertHold(
        {
          clinicId: input.clinicId,
          slotId: input.slotId,
          sessionId: input.sessionId ?? null,
          patientPhone: input.patientPhone ?? null,
          status: 'active',
          holdExpiresAt,
        },
        tx,
      );
      const hold = created;

      if (!hold) {
        throw new AppError('INTERNAL_ERROR', 'Failed to create slot hold.');
      }

      const [appointment] = await this.repos.slots.insertAppointment(
        {
          clinicId: input.clinicId,
          slotId: input.slotId,
          slotHoldId: hold.id,
          patientId: input.patientId ?? null,
          patientName: input.patientName,
          patientPhone: input.patientPhone ?? null,
          doctorId: slot.doctorId,
          clinicServiceId: slot.clinicServiceId,
          reasonForVisit: input.reasonForVisit,
          normalizedReason: input.reasonForVisit.toLowerCase(),
          appointmentStart: slot.startTime,
          appointmentEnd: slot.endTime,
          status: 'pending_confirmation',
          routingSource: input.routingSource ?? 'service_router',
          sourceSessionId: input.sessionId ?? null,
        },
        tx,
      );

      if (!appointment) {
        throw new AppError('INTERNAL_ERROR', 'Failed to create appointment.');
      }

      await this.repos.slots.updateHoldStatus(input.clinicId, hold.id, 'converted', tx);

      return { appointment, hold };
    });
  }

  async confirmAfterExpiredHold(input: {
    clinicId: string;
    slotId: string;
    holdId: string;
    patientName: string;
    patientPhone?: string;
    reasonForVisit: string;
    sessionId?: string;
    patientId?: string | null;
    routingSource?: string | null;
  }) {
    const db = this.dbService.database;
    const [hold] = await db
      .select()
      .from(slotHolds)
      .where(and(eq(slotHolds.clinicId, input.clinicId), eq(slotHolds.id, input.holdId)))
      .limit(1);

    if (!hold) {
      throw new AppError('SLOT_HOLD_EXPIRED', 'Slot hold not found.', {
        clinic_id: input.clinicId,
        hold_id: input.holdId,
      });
    }

    if (hold.status === 'active' && hold.holdExpiresAt > new Date()) {
      return this.createAppointmentFromHold(input);
    }

    try {
      const refreshedHold = await this.holdSlot({
        clinicId: input.clinicId,
        slotId: input.slotId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.patientPhone ? { patientPhone: input.patientPhone } : {}),
      });

      return this.createAppointmentFromHold({
        ...input,
        holdId: refreshedHold.id,
      });
    } catch (error) {
      if (error instanceof AppError && (error.code === 'SLOT_FULL' || error.code === 'SLOT_NOT_AVAILABLE')) {
        throw new AppError('SLOT_NOT_AVAILABLE', 'Capacity no longer available after hold expiry.', {
          clinic_id: input.clinicId,
          slot_id: input.slotId,
        });
      }
      throw error;
    }
  }

  async createAppointmentFromHold(input: {
    clinicId: string;
    slotId: string;
    holdId: string;
    patientName: string;
    patientPhone?: string;
    reasonForVisit: string;
    sessionId?: string;
    patientId?: string | null;
    routingSource?: string | null;
  }) {
    return this.dbService.withSlotForUpdate(input.clinicId, input.slotId, async (slot, tx) => {
      const [holiday] = await this.repos.slots.isDoctorHolidayForWindow(
        input.clinicId,
        slot.doctorId,
        slot.startTime,
        slot.endTime,
        tx,
      );
      if (holiday) {
        throw new AppError('SLOT_NOT_AVAILABLE', 'Selected slot falls on doctor holiday.', {
          clinic_id: input.clinicId,
          slot_id: input.slotId,
        });
      }

      const [hold] = await this.repos.slots.findHoldById(input.clinicId, input.holdId, tx);
      if (!hold) {
        throw new AppError('SLOT_HOLD_EXPIRED', 'Slot hold not found.', {
          clinic_id: input.clinicId,
          hold_id: input.holdId,
        });
      }
      if (hold.status !== ACTIVE_HOLD_STATUS || hold.holdExpiresAt <= new Date()) {
        throw new AppError('SLOT_HOLD_EXPIRED', 'Slot hold is no longer active.', {
          clinic_id: input.clinicId,
          hold_id: input.holdId,
        });
      }
      if (hold.slotId !== input.slotId) {
        throw new AppError('SLOT_HOLD_EXPIRED', 'Slot hold does not match the selected slot.', {
          clinic_id: input.clinicId,
          hold_id: input.holdId,
          slot_id: input.slotId,
        });
      }
      if (input.sessionId && hold.sessionId && hold.sessionId !== input.sessionId) {
        throw new AppError('SLOT_HOLD_EXPIRED', 'Slot hold does not match the conversation session.', {
          clinic_id: input.clinicId,
          hold_id: input.holdId,
          session_id: input.sessionId,
        });
      }

      const load = await this.repos.slots.countSlotLoad(
        input.clinicId,
        input.slotId,
        { excludeHoldId: input.holdId },
        tx,
      );
      const activeAppointments = load.activeAppointments;
      const otherActiveHolds = load.activeHolds;

      if (
        !hasCapacityToConvertHold({
          capacityTotal: slot.capacityTotal,
          activeAppointments,
          otherActiveHolds,
        })
      ) {
        throw new AppError('SLOT_FULL', 'Slot capacity is full.', {
          clinic_id: input.clinicId,
          slot_id: input.slotId,
        });
      }

      const [appointment] = await this.repos.slots.insertAppointment(
        {
          clinicId: input.clinicId,
          slotId: input.slotId,
          slotHoldId: input.holdId,
          patientId: input.patientId ?? null,
          patientName: input.patientName,
          patientPhone: input.patientPhone ?? null,
          doctorId: slot.doctorId,
          clinicServiceId: slot.clinicServiceId,
          reasonForVisit: input.reasonForVisit,
          normalizedReason: input.reasonForVisit.toLowerCase(),
          appointmentStart: slot.startTime,
          appointmentEnd: slot.endTime,
          status: 'pending_confirmation',
          routingSource: input.routingSource ?? 'service_router',
          sourceSessionId: input.sessionId ?? null,
        },
        tx,
      );

      await this.repos.slots.updateHoldStatus(input.clinicId, input.holdId, 'converted', tx);

      if (!appointment) {
        throw new AppError('INTERNAL_ERROR', 'Failed to create appointment.');
      }

      return appointment;
    });
  }

  async cancelAppointment(clinicId: string, appointmentId: string) {
    const [appointment] = await this.repos.slots.updateAppointmentStatus(
      clinicId,
      appointmentId,
      'cancelled',
    );

    if (!appointment) {
      throw new AppError('APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    }

    return appointment;
  }

  async releaseHold(clinicId: string, holdId: string) {
    const [hold] = await this.repos.slots.updateHoldStatus(clinicId, holdId, 'released');
    if (!hold) {
      throw new AppError('NOT_FOUND', 'Slot hold not found.');
    }
    return hold;
  }

  async releaseSessionHolds(clinicId: string, sessionId: string) {
    return this.repos.slots.releaseActiveHoldsForSession(clinicId, sessionId);
  }
}
