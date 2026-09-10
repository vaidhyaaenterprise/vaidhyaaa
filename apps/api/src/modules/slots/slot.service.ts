import { Inject, Injectable } from '@nestjs/common';

import {
  computeAvailableCount,
  createRepositories,
  DatabaseService,
  type Repositories,
} from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

import { SlotHoldExpiryService } from './slot-hold-expiry.service';
import { SlotHoldService, type HoldSlotInput } from './slot-hold.service';

export type SlotAvailability = {
  slot_id: string;
  clinic_id: string;
  doctor_id: string;
  clinic_service_id: string;
  start_time: string;
  end_time: string;
  capacity_total: number;
  available_count: number;
};

@Injectable()
export class SlotService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(DatabaseService) private readonly dbService: DatabaseService,
    @Inject(SlotHoldService) private readonly slotHoldService: SlotHoldService,
    @Inject(SlotHoldExpiryService) private readonly slotHoldExpiryService: SlotHoldExpiryService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async getSlotAvailability(clinicId: string, slotId: string): Promise<SlotAvailability | null> {
    const [slot] = await this.repos.slots.findOpenSlot(clinicId, slotId);
    if (!slot || slot.status !== 'open') {
      return null;
    }

    const [holiday] = await this.repos.slots.isDoctorHolidayForWindow(
      clinicId,
      slot.doctorId,
      slot.startTime,
      slot.endTime,
    );
    if (holiday) {
      return null;
    }

    const activeAppointments = await this.repos.slots.countActiveAppointments(clinicId, slotId);
    const activeHolds = await this.repos.slots.countActiveHolds(clinicId, slotId);
    const availableCount = computeAvailableCount({
      capacityTotal: slot.capacityTotal,
      activeAppointments,
      activeHolds,
    });

    return {
      slot_id: slot.id,
      clinic_id: slot.clinicId,
      doctor_id: slot.doctorId,
      clinic_service_id: slot.clinicServiceId,
      start_time: slot.startTime,
      end_time: slot.endTime,
      capacity_total: slot.capacityTotal,
      available_count: availableCount,
    };
  }

  async listProposableSlots(
    clinicId: string,
    doctorId: string,
    clinicServiceId: string,
    date?: string,
  ) {
    const slots = await this.repos.slots.listAvailableOpenSlots(clinicId, doctorId, clinicServiceId, date);
    if (slots.length === 0) {
      return [];
    }

    const slotIds = slots.map((slot) => slot.id);
    const [appointmentCounts, holdCounts] = await Promise.all([
      this.repos.slots.countActiveAppointmentsBySlots(clinicId, slotIds),
      this.repos.slots.countActiveHoldsBySlots(clinicId, slotIds),
    ]);

    const results: SlotAvailability[] = [];

    for (const slot of slots) {
      const activeAppointments = appointmentCounts.get(slot.id) ?? 0;
      const activeHolds = holdCounts.get(slot.id) ?? 0;
      const availableCount = computeAvailableCount({
        capacityTotal: slot.capacityTotal,
        activeAppointments,
        activeHolds,
      });

      if (availableCount > 0) {
        results.push({
          slot_id: slot.id,
          clinic_id: slot.clinicId,
          doctor_id: slot.doctorId,
          clinic_service_id: slot.clinicServiceId,
          start_time: slot.startTime,
          end_time: slot.endTime,
          capacity_total: slot.capacityTotal,
          available_count: availableCount,
        });
      }
    }

    return results;
  }

  async isSlotAvailable(clinicId: string, slotId: string): Promise<boolean> {
    const availability = await this.getSlotAvailability(clinicId, slotId);
    return Boolean(availability && availability.available_count > 0);
  }

  /** A02 alias */
  findAvailableSlots(
    clinicId: string,
    doctorId: string,
    clinicServiceId: string,
    date?: string,
  ) {
    return this.listProposableSlots(clinicId, doctorId, clinicServiceId, date);
  }

  tryHoldSlot(input: HoldSlotInput) {
    return this.slotHoldService.holdSlot(input);
  }

  releaseHold(clinicId: string, holdId: string) {
    return this.slotHoldService.releaseHold(clinicId, holdId);
  }

  expireOldHolds(clinicId?: string) {
    return this.slotHoldExpiryService.expireSlotHolds(clinicId ? { clinicId } : {});
  }
}
