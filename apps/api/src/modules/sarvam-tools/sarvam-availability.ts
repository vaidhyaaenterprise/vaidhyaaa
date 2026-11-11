import { randomInt } from 'node:crypto';
import type { TimePreference } from '@vaidya/shared';
import type { DoctorChoice } from './sarvam-routing';

export type DoctorAvailability = {
  doctor: DoctorChoice;
  rows: Array<{ start_time: string; available_count?: number }>;
};
export type TimeWindow = { lower: number; upper: number };

export function timeMinutes(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return hour! * 60 + minute!;
}

export function availabilityWindow(
  preference: TimePreference | null,
  after: string | null,
  before: string | null,
  exact: string | null,
): TimeWindow {
  const lower = preference === 'afternoon' ? 720 : preference === 'evening' ? 1020 : 0;
  const upper = preference === 'morning' ? 720 : preference === 'afternoon' ? 1020 : 1440;
  return {
    lower: Math.max(lower, after ? timeMinutes(after) : 0, exact ? timeMinutes(exact) : 0),
    upper: Math.min(
      upper,
      before ? timeMinutes(before) : 1440,
      exact ? timeMinutes(exact) + 1 : 1440,
    ),
  };
}

export function availableTimes(rows: DoctorAvailability['rows'], date: string) {
  return [
    ...new Set(
      rows
        .filter((row) => (row.available_count ?? 1) > 0 && row.start_time.slice(0, 10) === date)
        .map((row) => row.start_time.slice(11, 16)),
    ),
  ].sort();
}

/** Choose doctors uniformly, not weighted by how many slots they have. */
export function chooseAvailability(
  availability: DoctorAvailability[],
  date: string,
  window: TimeWindow,
  beforeOnly: boolean,
  limit: number,
  pickIndex: (count: number) => number = randomInt,
) {
  const distance = (time: string) => {
    const minute = timeMinutes(time);
    return minute < window.lower ? window.lower - minute : Math.max(0, minute - window.upper + 1);
  };
  const doctors = availability.map(({ doctor, rows }) => ({
    doctor,
    times: availableTimes(rows, date),
  }));
  const matches = doctors
    .map(({ doctor, times }) => ({
      doctor,
      times: times.filter((time) => distance(time) === 0),
    }))
    .filter(({ times }) => times.length > 0);
  if (matches.length) {
    const selected = matches[pickIndex(matches.length)]!;
    return {
      doctor: selected.doctor,
      times: beforeOnly ? selected.times.slice(-limit) : selected.times.slice(0, limit),
      status: 'matched' as const,
    };
  }
  const withSlots = doctors.filter(({ times }) => times.length > 0);
  if (!withSlots.length) return { doctor: null, times: [], status: 'no_slots' as const };
  const nearestDistance = Math.min(...withSlots.flatMap(({ times }) => times.map(distance)));
  const nearestDoctors = withSlots.filter(({ times }) =>
    times.some((time) => distance(time) === nearestDistance),
  );
  const selected = nearestDoctors[pickIndex(nearestDoctors.length)]!;
  return {
    doctor: selected.doctor,
    times: [...selected.times]
      .sort((a, b) => distance(a) - distance(b) || a.localeCompare(b))
      .slice(0, 3)
      .sort(),
    status: 'same_day_alternative' as const,
  };
}

export function availabilityOverview(availability: DoctorAvailability[], from: string, to: string) {
  return availability.map(({ doctor, rows }) => {
    const dates = [
      ...new Set(
        rows
          .filter((row) => (row.available_count ?? 1) > 0)
          .map((row) => row.start_time.slice(0, 10))
          .filter((date) => date >= from && date <= to),
      ),
    ].sort();
    return {
      ...doctor,
      availableDatesText: dates.join(', '),
      availabilityText: dates
        .map((date) => `${date}: ${availableTimes(rows, date).join(', ')}`)
        .join('; '),
    };
  });
}
