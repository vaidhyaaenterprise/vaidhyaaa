import { Inject, Injectable } from '@nestjs/common';
import { BOOKING_HORIZON_DAYS } from '@vaidya/shared';

import {
  addDays,
  addMinutes,
  appointmentSlots,
  combineDateAndTime,
  createRepositories,
  dayOfWeekMon1,
  formatClinicLocalTimestamp,
  formatDateInTimezone,
  intervalsOverlap,
  normalizeTimeString,
  toStoredDayOfWeek,
  sql,
  type Repositories,
} from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

export type GenerateSlotsInput = {
  clinicId?: string;
  doctorId?: string;
  clinicServiceId?: string;
  horizonDays?: number;
  date?: string;
};

@Injectable()
export class SlotGenerationService {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async generateSlots(input: GenerateSlotsInput = {}) {
    const targets = await this.repos.slots.listActiveGenerationTargets(input.clinicId);
    const clinicIds = [...new Set(targets.map((target) => target.clinicId))];
    const summaries = [];
    for (const clinicId of clinicIds) {
      const results = await this.withClinicLock(clinicId, async (repos) => {
        // Reload after acquiring the same lock used by settings saves. Never
        // commit a stale generation plan over a newer configuration.
        const currentTargets = await repos.slots.listActiveGenerationTargets(clinicId);
        const results = [];
        for (const target of currentTargets) {
          if (input.doctorId && target.doctorId !== input.doctorId) {
            continue;
          }
          if (input.clinicServiceId && target.clinicServiceId !== input.clinicServiceId) {
            continue;
          }

          // Internal repair jobs may generate a smaller range, but clinic settings
          // (including legacy values) cannot change the 45-day booking window.
          const targetHorizonDays = Math.min(
            input.horizonDays ?? BOOKING_HORIZON_DAYS,
            BOOKING_HORIZON_DAYS,
          );
          if (input.date) {
            const targetToday = formatDateInTimezone(new Date(), target.clinicTimezone);
            const targetEndDate = addDays(targetToday, targetHorizonDays, target.clinicTimezone);
            if (input.date < targetToday || input.date > targetEndDate) {
              continue;
            }
          }

          const summary = await this.generateForTarget(
            target.clinicId,
            target.clinicTimezone,
            target.doctorId,
            target.doctorServiceId,
            target.clinicServiceId,
            target.rule,
            targetHorizonDays,
            input.date,
            repos,
            currentTargets
              .filter(
                (peer) =>
                  peer.doctorId === target.doctorId &&
                  peer.clinicServiceId === target.clinicServiceId,
              )
              .map((peer) => peer.rule),
          );
          if (summary) results.push(summary);
        }
        return results;
      });
      summaries.push(...results);
    }

    return summaries;
  }

  private withClinicLock<T>(clinicId: string, work: (repos: Repositories) => Promise<T>) {
    return this.connection.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`clinic-schedule:${clinicId}`}))`,
      );
      return work(createRepositories(tx));
    });
  }

  private async generateForTarget(
    clinicId: string,
    timezone: string,
    doctorId: string,
    doctorServiceId: string,
    clinicServiceId: string,
    rule: {
      id: string;
      slotDurationMinutes: number;
      capacityPerSlot: number;
      version: number;
      effectiveFrom?: string;
      effectiveTo?: string | null;
    },
    horizonDays: number,
    requestedDate?: string,
    repos: Repositories = this.repos,
    effectiveVersions: Array<{
      id: string;
      version: number;
      effectiveFrom?: string;
      effectiveTo?: string | null;
    }> = [rule],
  ) {
    const today = formatDateInTimezone(new Date(), timezone);
    const endDate = addDays(today, horizonDays, timezone);
    const generationStartDate = [requestedDate ?? today, rule.effectiveFrom ?? today]
      .sort()
      .at(-1)!;
    const generationEndDate = [requestedDate ?? endDate, rule.effectiveTo ?? endDate].sort()[0]!;
    if (generationStartDate > generationEndDate) return null;

    const generationDates: string[] = [];
    for (
      let date = generationStartDate;
      date <= generationEndDate;
      date = addDays(date, 1, timezone)
    ) {
      const newer = effectiveVersions.some(
        (peer) =>
          peer.version > rule.version &&
          (!peer.effectiveFrom || peer.effectiveFrom <= date) &&
          (!peer.effectiveTo || peer.effectiveTo >= date),
      );
      if (!newer) generationDates.push(date);
    }
    if (generationDates.length === 0) return null;
    const ownedDates = new Set(generationDates);
    const rangeStart = `${generationDates[0]} 00:00:00`;
    const rangeEnd = `${generationDates.at(-1)} 23:59:59`;
    const [[batch], schedules, clinicHours, holidays, blocked, existingWindows] = await Promise.all(
      [
        repos.slots.insertBatch({
          clinicId,
          triggerSource: 'daily_job',
          ruleId: rule.id,
          status: 'running',
          summaryJson: {},
        }),
        repos.slots.listDoctorSchedules(clinicId, doctorId, doctorServiceId),
        repos.slots.listClinicHours(clinicId),
        repos.slots.listClinicHolidays(clinicId, generationStartDate, generationEndDate, doctorId),
        repos.slots.listDoctorBlockedSlots(
          clinicId,
          doctorId,
          combineDateAndTime(generationStartDate, '00:00:00', timezone),
          combineDateAndTime(generationEndDate, '23:59:59', timezone),
        ),
        repos.slots.listExistingSlotWindows(
          clinicId,
          doctorId,
          clinicServiceId,
          rangeStart,
          rangeEnd,
        ),
      ],
    );
    // Legacy active versions can overlap. A lower version must not retire or
    // rewrite slots on dates owned by a newer effective version, in any order.
    const existingSlots = existingWindows.filter((slot) =>
      ownedDates.has(slot.startTime.slice(0, 10)),
    );
    const holidayDates = new Set(
      holidays.filter((holiday) => holiday.isFullDay).map((holiday) => holiday.holidayDate),
    );
    const holidayWindowsByDate = new Map<string, Array<{ start: string; end: string }>>();
    for (const holiday of holidays) {
      if (holiday.isFullDay || !holiday.startTime || !holiday.endTime) {
        continue;
      }
      const key = holiday.holidayDate;
      const list = holidayWindowsByDate.get(key) ?? [];
      list.push({
        start: normalizeTimeString(String(holiday.startTime)),
        end: normalizeTimeString(String(holiday.endTime)),
      });
      holidayWindowsByDate.set(key, list);
    }

    const existingIds = existingSlots.map((slot) => slot.id);
    const [appointmentCounts, holdCounts] = await Promise.all([
      repos.slots.countActiveAppointmentsBySlots(clinicId, existingIds),
      repos.slots.countActiveHoldsBySlots(clinicId, existingIds),
    ]);
    const occupiedSlots = existingSlots.filter(
      (slot) => (appointmentCounts.get(slot.id) ?? 0) + (holdCounts.get(slot.id) ?? 0) > 0,
    );
    let skipped = 0;
    const knownSlotWindows = new Set(
      existingSlots.map((slot) => `${slot.startTime}|${slot.endTime}`),
    );
    const desiredSlotWindows = new Set<string>();
    const slotsToInsert: Array<typeof appointmentSlots.$inferInsert> = [];

    for (const dateStr of generationDates) {
      if (holidayDates.has(dateStr)) {
        skipped += 1;
        continue;
      }

      const dayOfWeek = toStoredDayOfWeek(dayOfWeekMon1(dateStr, timezone));
      const daySchedules = schedules.filter(
        (schedule) =>
          schedule.dayOfWeek === dayOfWeek &&
          (!schedule.effectiveFrom || dateStr >= schedule.effectiveFrom) &&
          (!schedule.effectiveTo || dateStr <= schedule.effectiveTo),
      );
      if (daySchedules.length === 0) {
        continue;
      }

      const dayHours = clinicHours.filter((hours) => hours.dayOfWeek === dayOfWeek);
      for (const schedule of daySchedules) {
        const windows = intersectWindows(
          [
            {
              start: normalizeTimeString(String(schedule.startTime)),
              end: normalizeTimeString(String(schedule.endTime)),
            },
          ],
          dayHours.map((hours) => ({
            start: normalizeTimeString(String(hours.startTime)),
            end: normalizeTimeString(String(hours.endTime)),
          })),
        );

        for (const window of windows) {
          let cursor = combineDateAndTime(dateStr, window.start, timezone);
          const windowEnd = combineDateAndTime(dateStr, window.end, timezone);

          while (addMinutes(cursor, rule.slotDurationMinutes) <= windowEnd) {
            const slotEnd = addMinutes(cursor, rule.slotDurationMinutes);
            const overlapsBlocked = blocked.some((block) =>
              intervalsOverlap(cursor, slotEnd, block.startTime, block.endTime),
            );

            const startLocal = formatClinicLocalTimestamp(cursor, timezone);
            const endLocal = formatClinicLocalTimestamp(slotEnd, timezone);
            const slotStartTime = (startLocal.split(' ')[1] ?? '00:00:00').slice(0, 8);
            const slotEndTime = (endLocal.split(' ')[1] ?? '00:00:00').slice(0, 8);
            const holidayWindows = holidayWindowsByDate.get(dateStr) ?? [];
            const overlapsHoliday = holidayWindows.some(
              (windowRange) => slotStartTime < windowRange.end && slotEndTime > windowRange.start,
            );

            const overlapsOccupied = occupiedSlots.some(
              (slot) =>
                slot.startTime < endLocal &&
                slot.endTime > startLocal &&
                (slot.startTime !== startLocal || slot.endTime !== endLocal),
            );
            if (!overlapsBlocked && !overlapsHoliday && !overlapsOccupied) {
              const windowKey = `${startLocal}|${endLocal}`;
              desiredSlotWindows.add(windowKey);
              if (!knownSlotWindows.has(windowKey)) {
                slotsToInsert.push({
                  clinicId,
                  doctorId,
                  clinicServiceId,
                  startTime: startLocal,
                  endTime: endLocal,
                  capacityTotal: rule.capacityPerSlot,
                  status: 'open',
                  generatedFromRuleId: rule.id,
                  generationBatchId: batch?.id,
                  configVersion: rule.version,
                });
                knownSlotWindows.add(windowKey);
              } else {
                skipped += 1;
              }
            } else {
              skipped += 1;
            }

            cursor = slotEnd;
          }
        }
      }
    }

    const insertedSlots = await repos.slots.insertSlots(slotsToInsert);
    const inserted = insertedSlots.length;
    skipped += slotsToInsert.length - inserted;
    const staleOpenSlotIds = existingSlots
      .filter(
        (slot) =>
          slot.status === 'open' &&
          !occupiedSlots.includes(slot) &&
          !desiredSlotWindows.has(`${slot.startTime}|${slot.endTime}`),
      )
      .map((slot) => slot.id);
    const supersededSlots = await repos.slots.supersedeFutureOpenSlotsByIds(
      clinicId,
      staleOpenSlotIds,
    );
    const matchingIds = existingSlots
      .filter(
        (slot) =>
          slot.status === 'open' && desiredSlotWindows.has(`${slot.startTime}|${slot.endTime}`),
      )
      .map((slot) => slot.id);
    await repos.slots.updateGeneratedSlotConfiguration(clinicId, matchingIds, {
      generatedFromRuleId: rule.id,
      configVersion: rule.version,
      capacityTotal: rule.capacityPerSlot,
    });

    const summary = {
      clinic_id: clinicId,
      doctor_id: doctorId,
      clinic_service_id: clinicServiceId,
      inserted,
      superseded: supersededSlots.length,
      skipped,
      horizon_days: horizonDays,
    };

    if (batch) {
      await repos.slots.completeBatch(batch.id, clinicId, summary);
    }

    return summary;
  }
}

function intersectWindows(
  primary: Array<{ start: string; end: string }>,
  secondary: Array<{ start: string; end: string }>,
): Array<{ start: string; end: string }> {
  if (secondary.length === 0) {
    return [];
  }

  const results: Array<{ start: string; end: string }> = [];
  for (const left of primary) {
    for (const right of secondary) {
      const start = left.start > right.start ? left.start : right.start;
      const end = left.end < right.end ? left.end : right.end;
      if (start < end) {
        results.push({ start, end });
      }
    }
  }

  return results;
}
