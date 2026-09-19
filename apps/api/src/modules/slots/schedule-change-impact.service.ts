import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import {
  type ReplaceClinicHoursInput,
  type ReplaceDoctorSchedulesInput,
  type ScheduleConflictItem,
} from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

import { SlotRuleChangeImpactService } from './slot-rule-change-impact.service';

function normalizeClinicLocalTimestamp(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes('T')) {
    const [datePart = '', timePart = '00:00:00'] = trimmed.split('T');
    return `${datePart} ${timePart.length === 5 ? `${timePart}:00` : timePart.slice(0, 8)}`;
  }
  const [datePart = '', timePart = '00:00:00'] = trimmed.split(' ');
  return `${datePart} ${timePart.length === 5 ? `${timePart}:00` : timePart.slice(0, 8)}`;
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

type ScheduleWindow = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  active?: boolean;
  effective_from?: string | null | undefined;
  effective_to?: string | null | undefined;
};

type ScheduleAppointment = {
  id: string;
  appointmentStart: string;
  appointmentEnd: string;
};

type ClinicLocalTimestampParts = {
  date: string;
  dayOfWeek: number;
  time: string;
};

function parseClinicLocalTimestamp(value: string): ClinicLocalTimestampParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(
    value.trim(),
  );
  if (!match) {
    return null;
  }

  const [
    ,
    yearText = '',
    monthText = '',
    dayText = '',
    hourText = '',
    minuteText = '',
    secondText = '00',
  ] = match;
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  const second = Number.parseInt(secondText, 10);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    date: `${yearText}-${monthText}-${dayText}`,
    dayOfWeek: calendarDate.getUTCDay(),
    time: `${hourText}:${minuteText}:${secondText}`,
  };
}

function normalizeWindowTime(value: string): string {
  const [hour = '00', minute = '00', second = '00'] = value.split(':');
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`;
}

function appointmentFitsWindows(
  appointment: ScheduleAppointment,
  windows: ScheduleWindow[],
): boolean {
  const start = parseClinicLocalTimestamp(appointment.appointmentStart);
  const end = parseClinicLocalTimestamp(appointment.appointmentEnd);
  if (!start || !end || start.date !== end.date) {
    return false;
  }

  const applicableRanges = windows
    .filter((window) => {
      if (window.active === false || window.day_of_week !== start.dayOfWeek) {
        return false;
      }
      if (window.effective_from && start.date < window.effective_from) {
        return false;
      }
      return !window.effective_to || start.date <= window.effective_to;
    })
    .map((window) => ({
      start: normalizeWindowTime(window.start_time),
      end: normalizeWindowTime(window.end_time),
    }))
    .sort((left, right) => left.start.localeCompare(right.start));

  const mergedRanges: Array<{ start: string; end: string }> = [];
  for (const range of applicableRanges) {
    const previous = mergedRanges[mergedRanges.length - 1];
    if (previous && range.start <= previous.end) {
      if (range.end > previous.end) {
        previous.end = range.end;
      }
    } else {
      mergedRanges.push({ ...range });
    }
  }

  return mergedRanges.some(
    (range) => start.time >= range.start && end.time <= range.end,
  );
}

/**
 * Schedule replacement is blocked only by appointments that the change newly
 * excludes. Existing outliers must not prevent an unrelated schedule expansion.
 */
export function findNewlyExcludedScheduleAppointments<T extends ScheduleAppointment>(
  appointments: T[],
  currentWindows: ScheduleWindow[],
  proposedWindows: ScheduleWindow[],
): T[] {
  return appointments.filter(
    (appointment) =>
      appointmentFitsWindows(appointment, currentWindows) &&
      !appointmentFitsWindows(appointment, proposedWindows),
  );
}

@Injectable()
export class ScheduleChangeImpactService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(SlotRuleChangeImpactService)
    private readonly ruleImpactService: SlotRuleChangeImpactService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  previewBookingRuleChange(
    clinicId: string,
    ruleId: string,
    patch: { capacity_per_slot?: number; slot_duration_minutes?: number },
  ): Promise<{ blocked: boolean; conflicts: ScheduleConflictItem[]; next_safe_implement_from?: string }> {
    const tasks: Promise<{ blocked: boolean; conflicts: ScheduleConflictItem[]; next_safe_implement_from?: string }>[] = [];

    if (patch.capacity_per_slot !== undefined) {
      tasks.push(this.ruleImpactService.previewCapacityChange(clinicId, ruleId, patch.capacity_per_slot));
    }
    if (patch.slot_duration_minutes !== undefined) {
      tasks.push(
        this.ruleImpactService.previewDurationChange(clinicId, ruleId, patch.slot_duration_minutes),
      );
    }

    if (tasks.length === 0) {
      return Promise.resolve({ blocked: false, conflicts: [] as ScheduleConflictItem[] });
    }

    return Promise.all(tasks).then((results) => {
      const conflicts = results.flatMap((result) => result.conflicts);
      const nextSafeCandidates = results
        .map((result) => result.next_safe_implement_from)
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
      const nextSafe = maxClinicLocalTimestamp(nextSafeCandidates);

      return {
        blocked: conflicts.length > 0,
        conflicts,
        ...(nextSafe ? { next_safe_implement_from: nextSafe } : {}),
      };
    });
  }

  async applyBookingRuleChange(
    clinicId: string,
    ruleId: string,
    patch: { capacity_per_slot?: number; slot_duration_minutes?: number; implement_from?: string },
  ) {
    if (patch.capacity_per_slot !== undefined) {
      return this.ruleImpactService.applyCapacityChangeFrom(
        clinicId,
        ruleId,
        patch.capacity_per_slot,
        patch.implement_from,
      );
    }
    if (patch.slot_duration_minutes !== undefined) {
      return this.ruleImpactService.applyDurationChangeFrom(
        clinicId,
        ruleId,
        patch.slot_duration_minutes,
        patch.implement_from,
      );
    }
    return { updated_slots: 0, conflicts: [] };
  }

  async previewClinicHoursReplace(
    clinicId: string,
    input: ReplaceClinicHoursInput,
  ): Promise<{ blocked: boolean; conflicts: ScheduleConflictItem[] }> {
    const conflicts = await this.findHoursConflicts(clinicId, input.windows);
    return { blocked: conflicts.length > 0, conflicts };
  }

  async previewDoctorSchedulesReplace(
    clinicId: string,
    doctorId: string,
    input: ReplaceDoctorSchedulesInput,
  ): Promise<{ blocked: boolean; conflicts: ScheduleConflictItem[] }> {
    const [currentRows, appointments] = await Promise.all([
      this.repos.clinicalSetup.listDoctorSchedules(clinicId, doctorId),
      this.repos.appointmentLifecycle.listFutureActiveAppointments(clinicId, doctorId),
    ]);
    const currentWindows: ScheduleWindow[] = currentRows.map((window) => ({
      day_of_week: window.dayOfWeek,
      start_time: window.startTime,
      end_time: window.endTime,
      active: window.active,
      effective_from: window.effectiveFrom,
      effective_to: window.effectiveTo,
    }));
    const conflicts = findNewlyExcludedScheduleAppointments(
      appointments,
      currentWindows,
      input.windows,
    ).map((appointment) => ({
      appointment_id: appointment.id,
      reason: 'outside_doctor_hours',
    }));

    return { blocked: conflicts.length > 0, conflicts };
  }

  async previewHolidayDate(clinicId: string, holidayDate: string, doctorIds?: string[]) {
    const rows = await this.repos.appointmentLifecycle.listActiveAppointmentsOnDate(
      clinicId,
      holidayDate,
      doctorIds,
    );
    const conflicts: ScheduleConflictItem[] = rows.map((row) => ({
      appointment_id: row.id,
      holiday_date: holidayDate,
      reason: 'active_appointment_on_holiday',
    }));
    return { blocked: conflicts.length > 0, conflicts };
  }

  private async findHoursConflicts(
    clinicId: string,
    windows: ReplaceClinicHoursInput['windows'],
  ): Promise<ScheduleConflictItem[]> {
    const [currentRows, appointments] = await Promise.all([
      this.repos.clinicalSetup.listClinicHours(clinicId),
      this.repos.appointmentLifecycle.listFutureActiveAppointments(clinicId),
    ]);
    const currentWindows: ScheduleWindow[] = currentRows.map((window) => ({
      day_of_week: window.dayOfWeek,
      start_time: window.startTime,
      end_time: window.endTime,
      active: window.active,
    }));

    return findNewlyExcludedScheduleAppointments(
      appointments,
      currentWindows,
      windows,
    ).map((appointment) => ({
      appointment_id: appointment.id,
      reason: 'outside_clinic_hours',
    }));
  }
}
