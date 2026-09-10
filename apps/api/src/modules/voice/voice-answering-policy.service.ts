import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, dayOfWeekMon1, formatDateInTimezone, type Repositories } from '@vaidya/db';
import { ANSWERING_MODES } from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';

type AnsweringMode = (typeof ANSWERING_MODES)[number];

export type AnsweringDecision = {
  shouldAnswer: boolean;
  reason: string;
};

@Injectable()
export class VoiceAnsweringPolicyService {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async evaluate(input: {
    clinicId: string;
    agentEnabled: boolean;
    answeringMode: AnsweringMode;
    fallbackPhone: string | null;
    overflowForwarded?: boolean;
  }): Promise<AnsweringDecision> {
    if (!input.agentEnabled) {
      return { shouldAnswer: false, reason: 'agent_disabled' };
    }

    if (!input.fallbackPhone) {
      return { shouldAnswer: false, reason: 'missing_fallback_phone' };
    }

    switch (input.answeringMode) {
      case 'off':
        return { shouldAnswer: false, reason: 'answering_mode_off' };
      case 'always_on':
        return { shouldAnswer: true, reason: 'always_on' };
      case 'overflow_after_n_rings':
        return input.overflowForwarded
          ? { shouldAnswer: true, reason: 'overflow_forwarded' }
          : { shouldAnswer: false, reason: 'overflow_not_forwarded' };
      case 'holiday_only': {
        const isHoliday = await this.isHolidayToday(input.clinicId);
        return isHoliday
          ? { shouldAnswer: true, reason: 'holiday_only_match' }
          : { shouldAnswer: false, reason: 'not_holiday' };
      }
      case 'after_hours_only': {
        const isAfterHours = await this.isAfterHours(input.clinicId);
        return isAfterHours
          ? { shouldAnswer: true, reason: 'after_hours' }
          : { shouldAnswer: false, reason: 'within_clinic_hours' };
      }
      default:
        return { shouldAnswer: false, reason: 'unsupported_answering_mode' };
    }
  }

  private async isHolidayToday(clinicId: string): Promise<boolean> {
    const [timezoneRow] = await this.repos.voice.getClinicTimezone(clinicId);
    const timezone = timezoneRow?.timezone ?? 'Asia/Kolkata';
    const today = formatDateInTimezone(new Date(), timezone);
    const [holiday] = await this.repos.voice.findHolidayOnDate(clinicId, today);
    return !!holiday;
  }

  private async isAfterHours(clinicId: string): Promise<boolean> {
    const [timezoneRow] = await this.repos.voice.getClinicTimezone(clinicId);
    const timezone = timezoneRow?.timezone ?? 'Asia/Kolkata';
    const now = new Date();
    const today = formatDateInTimezone(now, timezone);
    const [holiday] = await this.repos.voice.findHolidayOnDate(clinicId, today);
    if (holiday) {
      return true;
    }

    const dayOfWeek = dayOfWeekMon1(today, timezone);
    const hours = await this.repos.voice.listClinicHours(clinicId);
    const windows = hours.filter((row) => row.dayOfWeek === dayOfWeek);
    if (windows.length === 0) {
      return true;
    }

    const localTime = now.toLocaleTimeString('en-GB', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const withinWindow = windows.some((window) => {
      const start = String(window.startTime).slice(0, 8);
      const end = String(window.endTime).slice(0, 8);
      return localTime >= start && localTime < end;
    });

    return !withinWindow;
  }
}
