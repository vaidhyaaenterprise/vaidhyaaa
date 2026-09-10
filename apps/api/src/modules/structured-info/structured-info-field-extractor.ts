import { dayOfWeekMon1, formatDateInTimezone } from '@vaidya/db';
import type { TimingScope } from '@vaidya/shared';

export type { FeeVisitType, AvailabilityTarget } from '@vaidya/shared';

export {
  resolveTimingScopeFromClassification,
  resolveAvailabilityTargetFromClassification,
  resolveFeeVisitTypeFromClassification,
  isProcedureFeeFromClassification,
} from '@vaidya/shared';

export function formatFeeAmount(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') {
    return '';
  }
  const numeric = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(numeric)) {
    return '';
  }
  return `₹${Math.round(numeric)}`;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const DAY_PATTERNS: Array<{ pattern: RegExp; dayOfWeek: number; dayName: string }> = [
  { dayName: 'Monday', dayOfWeek: 1, pattern: /\b(monday|mon)\b/i },
  { dayName: 'Tuesday', dayOfWeek: 2, pattern: /\b(tuesday|tue)\b/i },
  { dayName: 'Wednesday', dayOfWeek: 3, pattern: /\b(wednesday|wed)\b/i },
  { dayName: 'Thursday', dayOfWeek: 4, pattern: /\b(thursday|thu)\b/i },
  { dayName: 'Friday', dayOfWeek: 5, pattern: /\b(friday|fri)\b/i },
  { dayName: 'Saturday', dayOfWeek: 6, pattern: /\b(saturday|sat)\b/i },
  { dayName: 'Sunday', dayOfWeek: 7, pattern: /\b(sunday|sun)\b/i },
];

export function extractTimingScope(text: string, _timezone: string): TimingScope {
  const normalized = normalize(text);

  if (/\b(inniku|inaiku|today|indru)\b/i.test(normalized)) {
    return { kind: 'today' };
  }

  for (const day of DAY_PATTERNS) {
    if (day.pattern.test(normalized)) {
      return { kind: 'day', dayOfWeek: day.dayOfWeek, dayName: day.dayName };
    }
  }

  return { kind: 'general' };
}

export function resolveTodayDayOfWeek(timezone: string): number {
  const today = formatDateInTimezone(new Date(), timezone);
  return dayOfWeekMon1(today, timezone);
}

function dedupeTimeRanges(ranges: string[]): string[] {
  return [...new Set(ranges)];
}

export function formatClinicHoursText(
  hours: Array<{ dayOfWeek: number; startTime: string; endTime: string }>,
): string {
  const byDay = new Map<number, string[]>();
  for (const row of hours) {
    const start = row.startTime.slice(0, 5);
    const end = row.endTime.slice(0, 5);
    const range = `${start}-${end}`;
    const existing = byDay.get(row.dayOfWeek) ?? [];
    if (!existing.includes(range)) {
      existing.push(range);
    }
    byDay.set(row.dayOfWeek, existing);
  }

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const parts: string[] = [];
  for (let day = 1; day <= 7; day += 1) {
    const ranges = byDay.get(day);
    if (!ranges || ranges.length === 0) {
      continue;
    }
    parts.push(`${dayNames[day - 1]} ${dedupeTimeRanges(ranges).join(', ')}`);
  }
  return parts.join('; ');
}

export function formatDayHoursText(
  hours: Array<{ startTime: string; endTime: string }>,
): string {
  if (hours.length === 0) {
    return 'closed';
  }
  const ranges = hours.map((row) => `${row.startTime.slice(0, 5)}-${row.endTime.slice(0, 5)}`);
  return dedupeTimeRanges(ranges).join(', ');
}
