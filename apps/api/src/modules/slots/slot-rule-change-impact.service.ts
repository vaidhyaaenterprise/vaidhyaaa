import { Inject, Injectable } from '@nestjs/common';

import {
  combineDateAndTime,
  createRepositories,
  formatDateInTimezone,
  formatTimeInTimezone,
  type Repositories,
} from '@vaidya/db';
import { AppError } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

import { SlotGenerationService } from './slot-generation.service';

export type RuleChangeConflict = {
  slot_id: string;
  slot_start?: string;
  slot_end?: string;
  appointment_id?: string;
  hold_id?: string;
  reason: string;
};

type RuleChangePatch = {
  capacity_per_slot?: number;
  slot_duration_minutes?: number;
};

function normalizeClinicLocalTimestamp(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes('T')) {
    const [datePart = '', timePart = '00:00:00'] = trimmed.split('T');
    return `${datePart} ${timePart.length === 5 ? `${timePart}:00` : timePart.slice(0, 8)}`;
  }
  const [datePart = '', timePart = '00:00:00'] = trimmed.split(' ');
  return `${datePart} ${timePart.length === 5 ? `${timePart}:00` : timePart.slice(0, 8)}`;
}

function formatClinicLocalTimestampForUi(raw: string): string {
  const normalized = normalizeClinicLocalTimestamp(raw);
  const [datePart, timePart = '00:00:00'] = normalized.split(' ');
  return `${datePart} ${timePart.slice(0, 5)}`;
}

function datePartOfTimestamp(value: string): string {
  return normalizeClinicLocalTimestamp(value).split(' ')[0] ?? value;
}

function midnightAfterDate(dateStr: string, timezone: string): string {
  const midnight = combineDateAndTime(dateStr, '00:00:00', timezone);
  const nextMidnight = new Date(midnight.getTime());
  nextMidnight.setDate(nextMidnight.getDate() + 1);
  return `${formatDateInTimezone(nextMidnight, timezone)} ${formatTimeInTimezone(nextMidnight, timezone)}`;
}

function maxClinicLocalTimestamp(values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) =>
    normalizeClinicLocalTimestamp(a).localeCompare(normalizeClinicLocalTimestamp(b)),
  );
  return sorted[sorted.length - 1] ?? null;
}

@Injectable()
export class SlotRuleChangeImpactService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(SlotGenerationService) private readonly slotGenerationService: SlotGenerationService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async applyCapacityChange(
    clinicId: string,
    ruleId: string,
    newCapacity: number,
  ): Promise<{ updated_slots: number; conflicts: RuleChangeConflict[] }> {
    return this.applyCapacityChangeFrom(clinicId, ruleId, newCapacity);
  }

  async applyCapacityChangeFrom(
    clinicId: string,
    ruleId: string,
    newCapacity: number,
    implementFrom?: string,
  ): Promise<{ updated_slots: number; conflicts: RuleChangeConflict[] }> {
    const normalizedImplementFrom = implementFrom
      ? normalizeClinicLocalTimestamp(implementFrom)
      : undefined;

    const [rule] = await this.repos.slots.findBookingRule(clinicId, ruleId);
    if (!rule) {
      throw new AppError('NOT_FOUND', 'Booking rule not found.');
    }

    const conflicts = await this.findCapacityConflicts(
      clinicId,
      ruleId,
      newCapacity,
      normalizedImplementFrom,
    );
    if (conflicts.length > 0) {
      throw new AppError('CONFLICTING_APPOINTMENTS', 'Capacity decrease would conflict with occupancy.', {
        conflicts,
      });
    }

    const updatedSlots = await this.repos.slots.updateFutureOpenSlotCapacity(
      clinicId,
      ruleId,
      newCapacity,
      rule.version,
      normalizedImplementFrom,
    );

    await this.repos.slots.updateBookingRule(clinicId, ruleId, {
      capacityPerSlot: newCapacity,
      version: rule.version + 1,
      ...(normalizedImplementFrom
        ? { effectiveFrom: datePartOfTimestamp(normalizedImplementFrom) }
        : {}),
    });

    return { updated_slots: updatedSlots.length, conflicts: [] as RuleChangeConflict[] };
  }

  async applyDurationChange(
    clinicId: string,
    ruleId: string,
    newDurationMinutes: number,
  ): Promise<{ superseded_slots: number; conflicts: RuleChangeConflict[] }> {
    return this.applyDurationChangeFrom(clinicId, ruleId, newDurationMinutes);
  }

  async applyDurationChangeFrom(
    clinicId: string,
    ruleId: string,
    newDurationMinutes: number,
    implementFrom?: string,
  ): Promise<{ superseded_slots: number; conflicts: RuleChangeConflict[] }> {
    const normalizedImplementFrom = implementFrom
      ? normalizeClinicLocalTimestamp(implementFrom)
      : undefined;

    const [rule] = await this.repos.slots.findBookingRule(clinicId, ruleId);
    if (!rule) {
      throw new AppError('NOT_FOUND', 'Booking rule not found.');
    }

    const futureSlots = await this.repos.slots.listFutureOpenSlotsForRule(
      clinicId,
      ruleId,
      normalizedImplementFrom,
    );
    const conflicts: RuleChangeConflict[] = [];

    for (const slot of futureSlots) {
      const activeAppointments = await this.repos.slots.countActiveAppointments(clinicId, slot.id);
      const activeHolds = await this.repos.slots.countActiveHolds(clinicId, slot.id);
      if (activeAppointments + activeHolds > 0) {
        conflicts.push({
          slot_id: slot.id,
          slot_start: slot.startTime,
          slot_end: slot.endTime,
          reason: 'future_occupancy_blocks_duration_change',
        });
      }
    }

    if (conflicts.length > 0) {
      throw new AppError('CONFLICTING_APPOINTMENTS', 'Duration change would conflict with future occupancy.', {
        conflicts,
      });
    }

    await this.repos.slots.supersedeFutureOpenSlots(clinicId, ruleId, normalizedImplementFrom);
    await this.repos.slots.updateBookingRule(clinicId, ruleId, {
      slotDurationMinutes: newDurationMinutes,
      version: rule.version + 1,
      ...(normalizedImplementFrom
        ? { effectiveFrom: datePartOfTimestamp(normalizedImplementFrom) }
        : {}),
    });

    await this.slotGenerationService.generateSlots({
      clinicId,
      doctorId: rule.doctorId,
      clinicServiceId: rule.clinicServiceId,
    });

    return { superseded_slots: futureSlots.length, conflicts: [] as RuleChangeConflict[] };
  }

  private async findCapacityConflicts(
    clinicId: string,
    ruleId: string,
    newCapacity: number,
    implementFrom?: string,
  ): Promise<RuleChangeConflict[]> {
    const futureSlots = await this.repos.slots.listFutureOpenSlotsForRule(clinicId, ruleId, implementFrom);
    const conflicts: RuleChangeConflict[] = [];

    for (const slot of futureSlots) {
      const activeAppointments = await this.repos.slots.countActiveAppointments(clinicId, slot.id);
      const activeHolds = await this.repos.slots.countActiveHolds(clinicId, slot.id);
      const occupied = activeAppointments + activeHolds;

      if (occupied > newCapacity) {
        conflicts.push({
          slot_id: slot.id,
          slot_start: slot.startTime,
          slot_end: slot.endTime,
          reason: 'occupied_exceeds_new_capacity',
        });
      }
    }

    return conflicts;
  }

  async previewCapacityChange(clinicId: string, ruleId: string, newCapacity: number) {
    const [rule] = await this.repos.slots.findBookingRule(clinicId, ruleId);
    if (!rule) {
      throw new AppError('NOT_FOUND', 'Booking rule not found.');
    }

    const conflicts = await this.findCapacityConflicts(clinicId, ruleId, newCapacity);
    if (conflicts.length === 0) {
      return { blocked: false, conflicts: [] as RuleChangeConflict[] };
    }

    const nextSafe = await this.findNextSafeImplementFrom(clinicId, ruleId, {
      capacity_per_slot: newCapacity,
    });
    return {
      blocked: true,
      conflicts,
      ...(nextSafe ? { next_safe_implement_from: formatClinicLocalTimestampForUi(nextSafe) } : {}),
    };
  }

  async previewDurationChange(clinicId: string, ruleId: string, _newDurationMinutes: number) {
    const [rule] = await this.repos.slots.findBookingRule(clinicId, ruleId);
    if (!rule) {
      throw new AppError('NOT_FOUND', 'Booking rule not found.');
    }

    const futureSlots = await this.repos.slots.listFutureOpenSlotsForRule(clinicId, ruleId);
    const conflicts: RuleChangeConflict[] = [];

    for (const slot of futureSlots) {
      const activeAppointments = await this.repos.slots.countActiveAppointments(clinicId, slot.id);
      const activeHolds = await this.repos.slots.countActiveHolds(clinicId, slot.id);
      if (activeAppointments + activeHolds > 0) {
        conflicts.push({
          slot_id: slot.id,
          slot_start: slot.startTime,
          slot_end: slot.endTime,
          reason: 'future_occupancy_blocks_duration_change',
        });
      }
    }

    if (conflicts.length === 0) {
      return { blocked: false, conflicts: [] as RuleChangeConflict[] };
    }

    const nextSafe = await this.findNextSafeImplementFrom(clinicId, ruleId, {
      slot_duration_minutes: _newDurationMinutes,
    });
    return {
      blocked: true,
      conflicts,
      ...(nextSafe ? { next_safe_implement_from: formatClinicLocalTimestampForUi(nextSafe) } : {}),
    };
  }

  async findNextSafeImplementFrom(
    clinicId: string,
    ruleId: string,
    patch: RuleChangePatch,
  ): Promise<string | null> {
    const [rule] = await this.repos.slots.findBookingRule(clinicId, ruleId);
    if (!rule) {
      throw new AppError('NOT_FOUND', 'Booking rule not found.');
    }

    const [timezoneRow] = await this.repos.slots.findClinicTimezone(clinicId);
    const timezone = timezoneRow?.timezone ?? 'Asia/Kolkata';

    const futureSlots = await this.repos.slots.listFutureOpenSlotsForRule(clinicId, ruleId);
    if (futureSlots.length === 0) {
      const now = new Date();
      return `${formatDateInTimezone(now, timezone)} ${formatTimeInTimezone(now, timezone)}`;
    }

    const occupiedSlots: string[] = [];
    for (const slot of futureSlots) {
      const activeAppointments = await this.repos.slots.countActiveAppointments(clinicId, slot.id);
      const activeHolds = await this.repos.slots.countActiveHolds(clinicId, slot.id);
      const occupied = activeAppointments + activeHolds;

      if (patch.slot_duration_minutes !== undefined) {
        if (occupied > 0) {
          occupiedSlots.push(slot.startTime);
        }
        continue;
      }

      if (patch.capacity_per_slot !== undefined && occupied > patch.capacity_per_slot) {
        occupiedSlots.push(slot.startTime);
      }
    }

    if (occupiedSlots.length === 0) {
      return null;
    }

    const latestOccupied = maxClinicLocalTimestamp(occupiedSlots);
    if (!latestOccupied) {
      return null;
    }

    return midnightAfterDate(datePartOfTimestamp(latestOccupied), timezone);
  }
}
