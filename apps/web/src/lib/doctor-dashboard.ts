import type {
  ClinicHoursApiRow,
  DoctorScheduleApiRow,
  DoctorServiceApiRow,
  HolidayApiRow,
  ServiceApiRow,
} from '@/lib/api/clinic-clinical';

type Window = { start: number; end: number };

export type DoctorDayAvailability = {
  windows: Array<{ start: string; end: string; label: string }>;
  serviceNames: string[];
  state: 'scheduled' | 'holiday' | 'closed' | 'not_scheduled';
  message: string;
};

function minutes(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null;
  return hour * 60 + minute;
}

function windowFor(start: string, end: string): Window[] {
  const from = minutes(start);
  const to = minutes(end);
  return from !== null && to !== null && from < to ? [{ start: from, end: to }] : [];
}

function merge(windows: Window[]): Window[] {
  const merged: Window[] = [];
  for (const window of [...windows].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged.at(-1);
    if (previous && window.start <= previous.end) previous.end = Math.max(previous.end, window.end);
    else merged.push({ ...window });
  }
  return merged;
}

function subtract(windows: Window[], closure: Window): Window[] {
  return windows.flatMap((window) => {
    if (closure.end <= window.start || closure.start >= window.end) return [window];
    return [
      ...(closure.start > window.start ? [{ start: window.start, end: closure.start }] : []),
      ...(closure.end < window.end ? [{ start: closure.end, end: window.end }] : []),
    ];
  });
}

function time(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function timeLabel(value: number): string {
  const hour = Math.floor(value / 60) % 24;
  return `${String(hour % 12 || 12).padStart(2, '0')}:${String(value % 60).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

/** Working hours from saved configuration, not a promise of a free appointment slot. */
export function computeDoctorDayAvailability(input: {
  date: string;
  doctorId: string;
  schedules: DoctorScheduleApiRow[];
  clinicHours: ClinicHoursApiRow[];
  holidays: HolidayApiRow[];
  doctorServices: DoctorServiceApiRow[];
  services: ServiceApiRow[];
}): DoctorDayAvailability {
  const services = new Map(input.services.filter((row) => row.active).map((row) => [row.id, row]));
  const mappings = input.doctorServices.filter(
    (row) => row.active && row.doctor_id === input.doctorId && services.has(row.clinic_service_id),
  );
  const mappingIds = new Set(mappings.map((row) => row.id));
  const serviceNames = [
    ...new Set(mappings.map((row) => services.get(row.clinic_service_id)!.service_name)),
  ].sort();
  const empty = (
    state: DoctorDayAvailability['state'],
    message: string,
  ): DoctorDayAvailability => ({
    windows: [],
    serviceNames,
    state,
    message,
  });
  const date = new Date(`${input.date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input.date
  ) {
    return empty('not_scheduled', 'Choose a valid appointment date.');
  }
  const day = date.getUTCDay();
  const holidays = input.holidays.filter(
    (row) =>
      row.active &&
      row.holiday_date === input.date &&
      (row.applies_to_clinic ||
        row.doctor_ids.length === 0 ||
        row.doctor_ids.includes(input.doctorId)),
  );
  const fullDayHolidays = holidays.filter((row) => row.is_full_day);
  if (fullDayHolidays.length) {
    const reasons = [...new Set(fullDayHolidays.map((row) => row.reason?.trim()).filter(Boolean))];
    return empty(
      'holiday',
      reasons.length ? `Holiday: ${reasons.join('; ')}` : 'Holiday · no working hours.',
    );
  }
  const clinicWindows = merge(
    input.clinicHours
      .filter((row) => row.active && row.day_of_week === day)
      .flatMap((row) => windowFor(row.start_time, row.end_time)),
  );
  if (!clinicWindows.length) return empty('closed', 'Clinic closed on this date.');
  const doctorWindows = input.schedules
    .filter(
      (row) =>
        row.active &&
        row.doctor_id === input.doctorId &&
        row.day_of_week === day &&
        (!row.effective_from || row.effective_from.slice(0, 10) <= input.date) &&
        (!row.effective_to || row.effective_to.slice(0, 10) >= input.date) &&
        (!row.doctor_service_id || mappingIds.has(row.doctor_service_id)),
    )
    .flatMap((row) => windowFor(row.start_time, row.end_time));
  let windows = merge(
    doctorWindows.flatMap((doctor) =>
      clinicWindows.flatMap((clinic) => {
        const start = Math.max(doctor.start, clinic.start);
        const end = Math.min(doctor.end, clinic.end);
        return start < end ? [{ start, end }] : [];
      }),
    ),
  );
  if (!windows.length) return empty('not_scheduled', 'No working hours scheduled for this date.');
  for (const holiday of holidays) {
    const [closure] = windowFor(holiday.start_time ?? '', holiday.end_time ?? '');
    if (closure) windows = subtract(windows, closure);
  }
  if (!windows.length) return empty('holiday', 'No working hours available because of a holiday.');
  const displayWindows = windows.map((window) => ({
    start: time(window.start),
    end: time(window.end),
    label: `${timeLabel(window.start)} – ${timeLabel(window.end)}`,
  }));
  return {
    windows: displayWindows,
    serviceNames,
    state: 'scheduled',
    message: `Working hours: ${displayWindows.map((window) => window.label).join(', ')}`,
  };
}
