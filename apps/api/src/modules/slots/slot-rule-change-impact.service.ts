import { Inject, Injectable } from '@nestjs/common';

import {
  combineDateAndTime,
  createRepositories,
  formatDateInTimezone,
  formatTimeInTimezone,
  type Repositories,
} from '@vaidya/db';
import { AppError, MIN_SLOT_DURATION_MINUTES } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

import { SlotReconciliationService } from './slot-reconciliation.service';

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
    @Inject(SlotReconciliationService) private readonly reconciliation: SlotReconciliationService,
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
      throw new AppError(
        'CONFLICTING_APPOINTMENTS',
        'Capacity decrease would conflict with occupancy.',
        {
          conflicts,
        },
      );
    }

    await this.reconciliation.save(
      clinicId,
      {
        doctorId: rule.doctorId,
        clinicServiceId: rule.clinicServiceId,
        ruleChange: {
          ruleId,
          durationChanged: false,
          ...(normalizedImplementFrom ? { implementFrom: normalizedImplementFrom } : {}),
        },
      },
      async (repos) => {
        const currentConflicts = await this.findCapacityConflicts(
          clinicId,
          ruleId,
          newCapacity,
          normalizedImplementFrom,
          repos,
        );
        if (currentConflicts.length > 0)
          throw new AppError(
            'CONFLICTING_APPOINTMENTS',
            'Capacity decrease would conflict with occupancy.',
            { conflicts: currentConflicts },
          );
        const [currentRule] = await repos.slots.findBookingRule(clinicId, ruleId);
        return repos.slots.updateBookingRule(clinicId, ruleId, {
          capacityPerSlot: newCapacity,
          version: (currentRule?.version ?? rule.version) + 1,
          ...(normalizedImplementFrom
            ? { effectiveFrom: datePartOfTimestamp(normalizedImplementFrom) }
            : {}),
        });
      },
    );

    return { updated_slots: 0, conflicts: [] as RuleChangeConflict[] };
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
    if (
      !Number.isSafeInteger(newDurationMinutes) ||
      newDurationMinutes < MIN_SLOT_DURATION_MINUTES
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Slot duration must be a whole number of at least 15 minutes.',
      );
    }
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
    const occupancyBySlot = await this.getOccupancyBySlot(
      clinicId,
      futureSlots.map((slot) => slot.id),
    );
    const conflicts: RuleChangeConflict[] = [];

    for (const slot of futureSlots) {
      if ((occupancyBySlot.get(slot.id) ?? 0) > 0) {
        conflicts.push({
          slot_id: slot.id,
          slot_start: slot.startTime,
          slot_end: slot.endTime,
          reason: 'future_occupancy_blocks_duration_change',
        });
      }
    }

    if (conflicts.length > 0) {
      throw new AppError(
        'CONFLICTING_APPOINTMENTS',
        'Duration change would conflict with future occupancy.',
        {
          conflicts,
        },
      );
    }

    await this.reconciliation.save(
      clinicId,
      {
        doctorId: rule.doctorId,
        clinicServiceId: rule.clinicServiceId,
        ruleChange: {
          ruleId,
          durationChanged: true,
          ...(normalizedImplementFrom ? { implementFrom: normalizedImplementFrom } : {}),
        },
      },
      async (repos) => {
        const currentSlots = await repos.slots.listFutureOpenSlotsForRule(
          clinicId,
          ruleId,
          normalizedImplementFrom,
        );
        const occupancy = await this.getOccupancyBySlot(
          clinicId,
          currentSlots.map((slot) => slot.id),
          repos,
        );
        const currentConflicts = currentSlots
          .filter((slot) => (occupancy.get(slot.id) ?? 0) > 0)
          .map((slot) => ({
            slot_id: slot.id,
            slot_start: slot.startTime,
            slot_end: slot.endTime,
            reason: 'future_occupancy_blocks_duration_change',
          }));
        if (currentConflicts.length > 0)
          throw new AppError(
            'CONFLICTING_APPOINTMENTS',
            'Duration change would conflict with future occupancy.',
            { conflicts: currentConflicts },
          );
        const [currentRule] = await repos.slots.findBookingRule(clinicId, ruleId);
        return repos.slots.updateBookingRule(clinicId, ruleId, {
          slotDurationMinutes: newDurationMinutes,
          version: (currentRule?.version ?? rule.version) + 1,
          ...(normalizedImplementFrom
            ? { effectiveFrom: datePartOfTimestamp(normalizedImplementFrom) }
            : {}),
        });
      },
    );

    return { superseded_slots: 0, conflicts: [] as RuleChangeConflict[] };
  }

  private async findCapacityConflicts(
    clinicId: string,
    ruleId: string,
    newCapacity: number,
    implementFrom?: string,
    repos: Repositories = this.repos,
  ): Promise<RuleChangeConflict[]> {
    const futureSlots = await repos.slots.listFutureOpenSlotsForRule(
      clinicId,
      ruleId,
      implementFrom,
    );
    const occupancyBySlot = await this.getOccupancyBySlot(
      clinicId,
      futureSlots.map((slot) => slot.id),
      repos,
    );
    const conflicts: RuleChangeConflict[] = [];

    for (const slot of futureSlots) {
      const occupied = occupancyBySlot.get(slot.id) ?? 0;

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
    if (
      !Number.isSafeInteger(_newDurationMinutes) ||
      _newDurationMinutes < MIN_SLOT_DURATION_MINUTES
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Slot duration must be a whole number of at least 15 minutes.',
      );
    }
    const [rule] = await this.repos.slots.findBookingRule(clinicId, ruleId);
    if (!rule) {
      throw new AppError('NOT_FOUND', 'Booking rule not found.');
    }

    const futureSlots = await this.repos.slots.listFutureOpenSlotsForRule(clinicId, ruleId);
    const occupancyBySlot = await this.getOccupancyBySlot(
      clinicId,
      futureSlots.map((slot) => slot.id),
    );
    const conflicts: RuleChangeConflict[] = [];

    for (const slot of futureSlots) {
      if ((occupancyBySlot.get(slot.id) ?? 0) > 0) {
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

    const occupancyBySlot = await this.getOccupancyBySlot(
      clinicId,
      futureSlots.map((slot) => slot.id),
    );
    const occupiedSlots: string[] = [];
    for (const slot of futureSlots) {
      const occupied = occupancyBySlot.get(slot.id) ?? 0;

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

  private async getOccupancyBySlot(
    clinicId: string,
    slotIds: string[],
    repos: Repositories = this.repos,
  ): Promise<Map<string, number>> {
    const [appointmentCounts, holdCounts] = await Promise.all([
      repos.slots.countActiveAppointmentsBySlots(clinicId, slotIds),
      repos.slots.countActiveHoldsBySlots(clinicId, slotIds),
    ]);

    return new Map(
      slotIds.map((slotId) => [
        slotId,
        (appointmentCounts.get(slotId) ?? 0) + (holdCounts.get(slotId) ?? 0),
      ]),
    );
  }
}
