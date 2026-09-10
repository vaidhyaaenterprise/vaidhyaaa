import type { ExtractedBookingFields, TimePreference } from '../booking/extracted-fields';
import type { IntentClassifierResult } from '../adapters/index';

export type FeeVisitType = 'consultation' | 'followup';

export type TimingScope =
  | { kind: 'day'; dayOfWeek: number; dayName: string }
  | { kind: 'today' }
  | { kind: 'general' };

export type AvailabilityTarget = {
  dateStr: string;
  dateLabel: string;
  dayOfWeek: number;
};

const DAY_NAME_TO_DOW: Record<string, { dayOfWeek: number; dayName: string }> = {
  sunday: { dayOfWeek: 7, dayName: 'Sunday' },
  monday: { dayOfWeek: 1, dayName: 'Monday' },
  tuesday: { dayOfWeek: 2, dayName: 'Tuesday' },
  wednesday: { dayOfWeek: 3, dayName: 'Wednesday' },
  thursday: { dayOfWeek: 4, dayName: 'Thursday' },
  friday: { dayOfWeek: 5, dayName: 'Friday' },
  saturday: { dayOfWeek: 6, dayName: 'Saturday' },
};

const WEEKDAY_TO_DOW: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

function dayOfWeekMon1(dateStr: string, timezone: string): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(new Date(`${dateStr}T12:00:00`));
  return WEEKDAY_TO_DOW[weekday] ?? 1;
}

function normalizeTimePreference(value: string | null | undefined): TimePreference | undefined {
  const pref = value?.toLowerCase();
  if (pref === 'morning' || pref === 'afternoon' || pref === 'evening') {
    return pref;
  }
  return undefined;
}

export function mapClassificationToBookingFields(
  classification: IntentClassifierResult,
): ExtractedBookingFields {
  const entities = classification.entities;
  const fields: ExtractedBookingFields = {};

  if (entities.reasonForVisit) {
    fields.reason_for_visit = entities.reasonForVisit;
  }
  if (entities.doctorName) {
    fields.doctor_name_fragment = entities.doctorName.toLowerCase();
  }
  if (entities.patientName) {
    fields.patient_name = entities.patientName;
  }
  if (entities.date) {
    fields.preferred_date = entities.date;
  }
  const timePreference = normalizeTimePreference(entities.timePreference);
  if (timePreference) {
    fields.time_preference = timePreference;
  }
  if (entities.visitType === 'followup') {
    fields.is_followup = true;
  }

  return fields;
}

export function mergeExtractedBookingFields(
  primary: ExtractedBookingFields,
  secondary: ExtractedBookingFields,
): ExtractedBookingFields {
  return {
    ...primary,
    ...Object.fromEntries(
      Object.entries(secondary).filter(([, value]) => value !== undefined && value !== null),
    ),
  };
}

export function resolveTimingScopeFromClassification(
  classification: IntentClassifierResult,
  timezone: string,
): TimingScope {
  const { date, dayName } = classification.entities;
  const today = todayInTimezone(timezone);

  if (date) {
    if (date === today) {
      return { kind: 'today' };
    }
    const dayOfWeek = dayOfWeekMon1(date, timezone);
    const resolvedDayName =
      dayName ??
      Object.values(DAY_NAME_TO_DOW).find((entry) => entry.dayOfWeek === dayOfWeek)?.dayName ??
      'Day';
    return { kind: 'day', dayOfWeek, dayName: resolvedDayName };
  }

  if (dayName) {
    const resolved = DAY_NAME_TO_DOW[dayName.toLowerCase()];
    if (resolved) {
      return { kind: 'day', dayOfWeek: resolved.dayOfWeek, dayName: resolved.dayName };
    }
  }

  return { kind: 'general' };
}

export function resolveAvailabilityTargetFromClassification(
  classification: IntentClassifierResult,
  timezone: string,
): AvailabilityTarget | null {
  const { date, dayName } = classification.entities;
  if (!date) {
    return null;
  }

  return {
    dateStr: date,
    dateLabel: dayName ?? date,
    dayOfWeek: dayOfWeekMon1(date, timezone),
  };
}

export function resolveFeeVisitTypeFromClassification(
  classification: IntentClassifierResult,
): FeeVisitType {
  return classification.entities.visitType === 'followup' ? 'followup' : 'consultation';
}

export function isProcedureFeeFromClassification(classification: IntentClassifierResult): boolean {
  return classification.entities.feeCategory === 'procedure';
}
