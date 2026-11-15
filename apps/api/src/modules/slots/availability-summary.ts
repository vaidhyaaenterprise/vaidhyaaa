export type AvailabilitySlotRow = {
  start_time: string;
  end_time?: string;
  available_count?: number;
};

export type AvailabilityWindow = {
  startTime: string;
  endTime: string;
};

export type AvailabilitySummary = {
  availabilityWindows: AvailabilityWindow[];
  availabilityWindowsText: string;
  slotFrequencyMinutes: number | null;
  slotFrequencyText: string;
};

type ParsedTimestamp = {
  date: string;
  minuteOfDay: number;
  absoluteMinute: number;
};

function parseTimestamp(value: string | undefined): ParsedTimestamp | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const date = `${yearText}-${monthText}-${dayText}`;
  const minuteOfDay = hour * 60 + minute;
  const absoluteMinute = Math.floor(Date.UTC(year, month - 1, day) / 60_000) + minuteOfDay;
  return { date, minuteOfDay, absoluteMinute };
}

function formatMinuteOfDay(value: number): string {
  const normalized = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function mostCommonPositive(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const value of values) {
    if (!Number.isInteger(value) || value <= 0 || value > 1440) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let selected: number | null = null;
  let selectedCount = 0;
  for (const [value, count] of counts) {
    if (
      count > selectedCount ||
      (count === selectedCount && (selected === null || value < selected))
    ) {
      selected = value;
      selectedCount = count;
    }
  }
  return selected;
}

function availableRowsForDate<T extends AvailabilitySlotRow>(rows: T[], date: string) {
  return rows
    .filter((row) => (row.available_count ?? 1) > 0)
    .map((row) => ({
      row,
      start: parseTimestamp(row.start_time),
      end: parseTimestamp(row.end_time),
    }))
    .filter(
      (
        entry,
      ): entry is {
        row: T;
        start: ParsedTimestamp;
        end: ParsedTimestamp | null;
      } => entry.start?.date === date,
    )
    .sort((left, right) => left.start.absoluteMinute - right.start.absoluteMinute);
}

/**
 * Summarises only genuinely open slots. Missing/booked slots split a window,
 * so callers are never told a blocked time is available.
 */
export function summarizeAvailability<T extends AvailabilitySlotRow>(
  rows: T[],
  date: string,
  configuredFrequencyMinutes?: number | null,
): AvailabilitySummary {
  const available = availableRowsForDate(rows, date);
  const validDurations = available.flatMap(({ start, end }) => {
    const duration = end ? end.absoluteMinute - start.absoluteMinute : 0;
    return duration > 0 && duration <= 1440 ? [duration] : [];
  });
  const adjacentGaps = available.slice(1).flatMap((entry, index) => {
    const previous = available[index];
    const gap = previous ? entry.start.absoluteMinute - previous.start.absoluteMinute : 0;
    return gap > 0 && gap <= 1440 ? [gap] : [];
  });
  const configuredFrequency =
    configuredFrequencyMinutes &&
    Number.isInteger(configuredFrequencyMinutes) &&
    configuredFrequencyMinutes > 0
      ? configuredFrequencyMinutes
      : null;
  const slotFrequencyMinutes =
    configuredFrequency ?? mostCommonPositive(validDurations) ?? mostCommonPositive(adjacentGaps);

  const windows: Array<{ start: number; end: number }> = [];
  for (const entry of available) {
    const explicitEnd = entry.end?.absoluteMinute ?? 0;
    const end =
      explicitEnd > entry.start.absoluteMinute
        ? explicitEnd
        : entry.start.absoluteMinute + (slotFrequencyMinutes ?? 0);
    const current = windows.at(-1);
    if (current && entry.start.absoluteMinute <= current.end) {
      current.end = Math.max(current.end, end);
    } else {
      windows.push({ start: entry.start.absoluteMinute, end });
    }
  }

  const availabilityWindows = windows.map((window) => ({
    startTime: formatMinuteOfDay(window.start),
    endTime: formatMinuteOfDay(window.end),
  }));
  const availabilityWindowsText = availabilityWindows
    .map((window) => `${window.startTime}-${window.endTime}`)
    .join(', ');

  return {
    availabilityWindows,
    availabilityWindowsText,
    slotFrequencyMinutes,
    slotFrequencyText: slotFrequencyMinutes ? `every ${slotFrequencyMinutes} minutes` : '',
  };
}

export function slotStartTime24h(startTime: string): string {
  const parsed = parseTimestamp(startTime);
  return parsed ? formatMinuteOfDay(parsed.minuteOfDay) : startTime.slice(11, 16);
}

export function findAvailableRowAtTime<T extends AvailabilitySlotRow>(
  rows: T[],
  date: string,
  time: string,
): T | undefined {
  return availableRowsForDate(rows, date).find(
    ({ start }) => formatMinuteOfDay(start.minuteOfDay) === time,
  )?.row;
}

export function nearestAvailableRows<T extends AvailabilitySlotRow>(
  rows: T[],
  date: string,
  time: string,
  limit = 3,
): T[] {
  const [hourText, minuteText] = time.split(':');
  const requestedMinute = Number(hourText) * 60 + Number(minuteText);
  if (!Number.isFinite(requestedMinute)) return [];
  return availableRowsForDate(rows, date)
    .sort(
      (left, right) =>
        Math.abs(left.start.minuteOfDay - requestedMinute) -
          Math.abs(right.start.minuteOfDay - requestedMinute) ||
        left.start.minuteOfDay - right.start.minuteOfDay,
    )
    .slice(0, Math.max(0, limit))
    .sort((left, right) => left.start.minuteOfDay - right.start.minuteOfDay)
    .map(({ row }) => row);
}
