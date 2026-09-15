import { Inject, Injectable } from '@nestjs/common';

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
  type Repositories,
} from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

export type GenerateSlotsInput = {
  clinicId?: string;
  doctorId?: string;
  clinicServiceId?: string;
  horizonDays?: number;
};

@Injectable()
export class SlotGenerationService {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async generateSlots(input: GenerateSlotsInput = {}) {
    const targets = await this.repos.slots.listActiveGenerationTargets(input.clinicId);
    const summaries = [];

    for (const target of targets) {
      if (input.doctorId && target.doctorId !== input.doctorId) {
        continue;
      }
      if (input.clinicServiceId && target.clinicServiceId !== input.clinicServiceId) {
        continue;
      }

      const summary = await this.generateForTarget(
        target.clinicId,
        target.clinicTimezone,
        target.doctorId,
        target.doctorServiceId,
        target.clinicServiceId,
        target.rule,
        input.horizonDays,
      );
      summaries.push(summary);
    }

    return summaries;
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
      bookingHorizonDays: number;
      version: number;
    },
    horizonOverride?: number,
  ) {
    const horizonDays = horizonOverride ?? rule.bookingHorizonDays;
    const today = formatDateInTimezone(new Date(), timezone);
    const endDate = addDays(today, horizonDays, timezone);

    const rangeStart = `${today} 00:00:00`;
    const rangeEnd = `${endDate} 23:59:59`;
    const [[batch], schedules, clinicHours, holidays, blocked, existingSlots] = await Promise.all([
      this.repos.slots.insertBatch({
        clinicId,
        triggerSource: 'daily_job',
        ruleId: rule.id,
        status: 'running',
        summaryJson: {},
      }),
      this.repos.slots.listDoctorSchedules(clinicId, doctorId, doctorServiceId),
      this.repos.slots.listClinicHours(clinicId),
      this.repos.slots.listClinicHolidays(clinicId, today, endDate, doctorId),
      this.repos.slots.listDoctorBlockedSlots(
        clinicId,
        doctorId,
        combineDateAndTime(today, '00:00:00', timezone),
        combineDateAndTime(endDate, '23:59:59', timezone),
      ),
      this.repos.slots.listExistingSlotWindows(
        clinicId,
        doctorId,
        clinicServiceId,
        rangeStart,
        rangeEnd,
      ),
    ]);
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

    let skipped = 0;
    const knownSlotWindows = new Set(
      existingSlots.map((slot) => `${slot.startTime}|${slot.endTime}`),
    );
    const slotsToInsert: Array<typeof appointmentSlots.$inferInsert> = [];

    for (let offset = 0; offset <= horizonDays; offset += 1) {
      const dateStr = addDays(today, offset, timezone);
      if (holidayDates.has(dateStr)) {
        skipped += 1;
        continue;
      }

      const dayOfWeek = dayOfWeekMon1(dateStr, timezone);
      const daySchedules = schedules.filter((schedule) => schedule.dayOfWeek === dayOfWeek);
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

            if (!overlapsBlocked && !overlapsHoliday) {
              const windowKey = `${startLocal}|${endLocal}`;
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

    const insertedSlots = await this.repos.slots.insertSlots(slotsToInsert);
    const inserted = insertedSlots.length;
    skipped += slotsToInsert.length - inserted;

    const summary = {
      clinic_id: clinicId,
      doctor_id: doctorId,
      clinic_service_id: clinicServiceId,
      inserted,
      skipped,
      horizon_days: horizonDays,
    };

    if (batch) {
      await this.repos.slots.completeBatch(batch.id, clinicId, summary);
    }

    return summary;
  }
}

function intersectWindows(
  primary: Array<{ start: string; end: string }>,
  secondary: Array<{ start: string; end: string }>,
): Array<{ start: string; end: string }> {
  if (secondary.length === 0) {
    return primary;
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
