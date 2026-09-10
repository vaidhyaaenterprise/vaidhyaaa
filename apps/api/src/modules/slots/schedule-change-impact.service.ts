import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import { type ReplaceClinicHoursInput, type ScheduleConflictItem } from '@vaidya/shared';

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

function extractTime(value: string): string {
  const timePart = value.includes('T') ? (value.split('T')[1] ?? value) : value;
  return timePart.slice(0, 5);
}

function extractDayOfWeek(value: string): number {
  const datePart = value.includes('T') ? (value.split('T')[0] ?? value) : value;
  const date = new Date(`${datePart}T12:00:00`);
  return date.getDay();
}

function fitsWindow(time: string, start: string, end: string): boolean {
  return time >= start.slice(0, 5) && time < end.slice(0, 5);
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
    const activeWindows = windows.filter((window) => window.active !== false);
    const appointments = await this.repos.appointmentLifecycle.listFutureActiveAppointments(clinicId);
    const conflicts: ScheduleConflictItem[] = [];

    for (const appointment of appointments) {
      const dayOfWeek = extractDayOfWeek(appointment.appointmentStart);
      const time = extractTime(appointment.appointmentStart);
      const dayWindows = activeWindows.filter((window) => window.day_of_week === dayOfWeek);
      const fits = dayWindows.some((window) =>
        fitsWindow(time, window.start_time, window.end_time),
      );
      if (!fits) {
        conflicts.push({
          appointment_id: appointment.id,
          reason: 'outside_clinic_hours',
        });
      }
    }

    return conflicts;
  }
}
