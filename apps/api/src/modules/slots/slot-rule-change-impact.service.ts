import { Inject, Injectable } from '@nestjs/common';

import {
  combineDateAndTime,
  addDays,
  createRepositories,
  formatDateInTimezone,
  formatTimeInTimezone,
  type Repositories,
} from '@vaidya/db';
import {
  AppError,
  BOOKING_HORIZON_DAYS,
  MIN_SLOT_DURATION_MINUTES,
  updateBookingRuleSchema,
  type UpdateBookingRuleInput,
} from '@vaidya/shared';

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

  async applyCapacityChange(clinicId: string, ruleId: string, newCapacity: number) {
    return this.applyCapacityChangeFrom(clinicId, ruleId, newCapacity);
  }

  async applyCapacityChangeFrom(
    clinicId: string,
    ruleId: string,
    newCapacity: number,
    implementFrom?: string,
  ) {
    await this.applyRuleUpdate(clinicId, ruleId, {
      capacity_per_slot: newCapacity,
      ...(implementFrom ? { implement_from: implementFrom } : {}),
    });
    return { updated_slots: 0, conflicts: [] as RuleChangeConflict[] };
  }

  async applyDurationChange(clinicId: string, ruleId: string, newDurationMinutes: number) {
    return this.applyDurationChangeFrom(clinicId, ruleId, newDurationMinutes);
  }

  async applyDurationChangeFrom(
    clinicId: string,
    ruleId: string,
    newDurationMinutes: number,
    implementFrom?: string,
  ) {
    await this.applyRuleUpdate(clinicId, ruleId, {
      slot_duration_minutes: newDurationMinutes,
      ...(implementFrom ? { implement_from: implementFrom } : {}),
    });
    return { superseded_slots: 0, conflicts: [] as RuleChangeConflict[] };
  }

  /** One configuration transaction and one outbox job, including combined changes. */
  async applyRuleUpdate(clinicId: string, ruleId: string, input: UpdateBookingRuleInput) {
    const parsed = updateBookingRuleSchema.safeParse(input);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]!.message);
    const patch = parsed.data;
    const [rule] = await this.repos.slots.findBookingRule(clinicId, ruleId);
    if (!rule) throw new AppError('NOT_FOUND', 'Booking rule not found.');
    return this.reconciliation.save(
      clinicId,
      {
        doctorId: rule.doctorId,
        clinicServiceId: rule.clinicServiceId,
      },
      async (repos) => {
        const [current] = await repos.slots.findBookingRule(clinicId, ruleId);
        if (!current) throw new AppError('NOT_FOUND', 'Booking rule not found.');
        const [timezoneRow] = await repos.slots.findClinicTimezone(clinicId);
        const timezone = timezoneRow?.timezone ?? 'Asia/Kolkata';
        const today = formatDateInTimezone(new Date(), timezone);
        const requested = patch.implement_from
          ? normalizeClinicLocalTimestamp(patch.implement_from)
          : undefined;
        // The UI offers whole-day cutovers. Reject fractional-day boundaries rather
        // than silently truncating a time that the date-only rule schema cannot store.
        if (requested && !requested.endsWith(' 00:00:00')) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Choose the start of a day for the booking rule change.',
          );
        }
        const startDate = requested
          ? datePartOfTimestamp(requested)
          : [today, current.effectiveFrom, patch.effective_from ?? today].sort().at(-1)!;
        if (startDate < today)
          throw new AppError('VALIDATION_ERROR', 'The implementation date cannot be in the past.');
        if (startDate < current.effectiveFrom) {
          throw new AppError(
            'VALIDATION_ERROR',
            'A change is already scheduled. Choose its start date or a later date.',
          );
        }
        const date = new Date(startDate + 'T00:00:00Z');
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== startDate) {
          throw new AppError('VALIDATION_ERROR', 'Choose a valid implementation date.');
        }
        const startFrom = startDate + ' 00:00:00';
        const futureSlots = await repos.slots.listFutureOpenSlotsForRule(
          clinicId,
          ruleId,
          startFrom,
        );
        const occupancy = await this.getOccupancyBySlot(
          clinicId,
          futureSlots.map((slot) => slot.id),
          repos,
        );
        const durationChanged =
          patch.slot_duration_minutes !== undefined &&
          patch.slot_duration_minutes !== current.slotDurationMinutes;
        const capacity = patch.capacity_per_slot ?? current.capacityPerSlot;
        const conflicts = futureSlots
          .filter((slot) => {
            const load = occupancy.get(slot.id) ?? 0;
            return durationChanged ? load > 0 : load > capacity;
          })
          .map((slot) => ({
            slot_id: slot.id,
            slot_start: slot.startTime,
            slot_end: slot.endTime,
            reason: durationChanged
              ? 'future_occupancy_blocks_duration_change'
              : 'occupied_exceeds_new_capacity',
          }));
        if (conflicts.length)
          throw new AppError(
            'CONFLICTING_APPOINTMENTS',
            'Appointments or reserved slots conflict with this change. Recheck the implementation date.',
            { conflicts },
          );

        const versions = await repos.clinicalSetup.listBookingRulesForDoctorService(
          clinicId,
          current.doctorId,
          current.clinicServiceId,
        );
        const latest = versions
          .filter((row) => row.active)
          .sort((a, b) => b.version - a.version)[0];
        if (latest && latest.id !== current.id)
          throw new AppError(
            'CONFLICT',
            'Booking rules changed while you were editing. Reload and try again.',
          );
        let version = Math.max(current.version, ...versions.map((row) => row.version)) + 1;
        // Keep a real configuration snapshot for the earlier dates. A daily repair
        // or retry can then regenerate the old duration without touching bookings.
        if (current.effectiveFrom < startDate) {
          const previousEnd = addDays(startDate, -1, timezone);
          await repos.clinicalSetup.createBookingRule({
            clinicId,
            doctorId: current.doctorId,
            clinicServiceId: current.clinicServiceId,
            slotDurationMinutes: current.slotDurationMinutes,
            capacityPerSlot: current.capacityPerSlot,
            bookingHorizonDays: BOOKING_HORIZON_DAYS,
            minBookingNoticeMinutes: current.minBookingNoticeMinutes,
            maxAdvanceBookingDays: current.maxAdvanceBookingDays,
            effectiveFrom: current.effectiveFrom,
            effectiveTo: previousEnd,
            active: true,
            version: version++,
          });
        }
        const [updated] = await repos.clinicalSetup.patchBookingRule(clinicId, ruleId, {
          slotDurationMinutes: patch.slot_duration_minutes ?? current.slotDurationMinutes,
          capacityPerSlot: capacity,
          bookingHorizonDays: BOOKING_HORIZON_DAYS,
          effectiveFrom: startDate,
          effectiveTo: patch.effective_to !== undefined ? patch.effective_to : current.effectiveTo,
          version,
          ...(patch.active !== undefined ? { active: patch.active } : {}),
          ...(patch.min_booking_notice_minutes !== undefined
            ? { minBookingNoticeMinutes: patch.min_booking_notice_minutes }
            : {}),
          ...(patch.max_advance_booking_days !== undefined
            ? { maxAdvanceBookingDays: patch.max_advance_booking_days }
            : {}),
        });
        if (!updated) throw new AppError('NOT_FOUND', 'Booking rule not found.');
        return updated;
      },
    );
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
