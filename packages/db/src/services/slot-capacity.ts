export const ACTIVE_APPOINTMENT_STATUSES = ['pending_confirmation', 'confirmed'] as const;
export const ACTIVE_HOLD_STATUS = 'active';
export const DEFAULT_HOLD_TTL_MS = 5 * 60 * 1000;

export type ClinicLocalTimestamp = string;

export function computeAvailableCount(input: {
  capacityTotal: number;
  activeAppointments: number;
  activeHolds: number;
}): number {
  return input.capacityTotal - input.activeAppointments - input.activeHolds;
}

export function hasCapacityAvailable(input: {
  capacityTotal: number;
  activeAppointments: number;
  activeHolds: number;
}): boolean {
  return computeAvailableCount(input) > 0;
}

/** True when an active hold can still be converted without exceeding slot capacity. */
export function hasCapacityToConvertHold(input: {
  capacityTotal: number;
  activeAppointments: number;
  otherActiveHolds: number;
}): boolean {
  return input.activeAppointments + input.otherActiveHolds < input.capacityTotal;
}

export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function formatDateInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatTimeInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  const second = parts.find((part) => part.type === 'second')?.value ?? '00';
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`;
}

/** Wall-clock timestamp in clinic timezone, e.g. "2026-06-13 18:00:00". */
export function formatClinicLocalTimestamp(date: Date, timezone: string): ClinicLocalTimestamp {
  return `${formatDateInTimezone(date, timezone)} ${formatTimeInTimezone(date, timezone)}`;
}

export function normalizeTimeString(timeStr: string): string {
  const raw = timeStr.trim();
  if (raw.includes('T')) {
    const timePart = raw.split('T')[1] ?? raw;
    return timePart.slice(0, 8).padEnd(8, ':00');
  }
  if (raw.length === 5) {
    return `${raw}:00`;
  }
  return raw.slice(0, 8);
}

export function dayOfWeekMon1(dateStr: string, timezone: string): number {
  const noon = combineDateAndTime(dateStr, '12:00:00', timezone);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(noon);
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[weekday] ?? 1;
}

export function combineDateAndTime(dateStr: string, timeStr: string, timezone: string): Date {
  const normalizedTime = normalizeTimeString(timeStr);
  if (timezone === 'Asia/Kolkata') {
    return new Date(`${dateStr}T${normalizedTime}+05:30`);
  }
  return new Date(`${dateStr}T${normalizedTime}Z`);
}

export function addDays(dateStr: string, days: number, timezone: string): string {
  const base = combineDateAndTime(dateStr, '12:00:00', timezone);
  base.setUTCDate(base.getUTCDate() + days);
  return formatDateInTimezone(base, timezone);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
