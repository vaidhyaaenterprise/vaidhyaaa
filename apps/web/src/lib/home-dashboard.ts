import type { Appointment } from '@/components/pages/appointments/types';

export type HomeDashboardGroups<T extends Appointment = Appointment> = {
  todayPending: T[];
  missedPending: T[];
  todayAppointments: T[];
};

/**
 * Return the calendar date at `now` in the clinic's configured timezone.
 *
 * Appointment starts are clinic-local wall-clock values. They must be grouped by
 * their already-mapped YYYY-MM-DD date instead of being parsed as instants.
 */
export function getClinicDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');

  if (!year || !month || !day) {
    throw new Error(`Unable to determine the clinic date for timezone: ${timezone}`);
  }

  return `${year}-${month}-${day}`;
}

function compareStartAscending(a: Appointment, b: Appointment): number {
  const byStart = `${a.appointmentDate}T${a.appointmentTime}`.localeCompare(
    `${b.appointmentDate}T${b.appointmentTime}`,
  );
  return byStart || a.id.localeCompare(b.id);
}

function compareStartDescending(a: Appointment, b: Appointment): number {
  const byStart = `${b.appointmentDate}T${b.appointmentTime}`.localeCompare(
    `${a.appointmentDate}T${a.appointmentTime}`,
  );
  return byStart || a.id.localeCompare(b.id);
}

/**
 * Group active appointments for the Home dashboard using lexical comparisons of
 * clinic-local calendar values. In particular, this deliberately never creates
 * a Date from an appointment start, which would incorrectly apply a timezone.
 */
export function groupHomeAppointments<T extends Appointment>(
  appointments: readonly T[],
  clinicDate: string,
  maxNext = 3,
): HomeDashboardGroups<T> {
  const active = appointments.filter(
    (appointment) =>
      appointment.status === 'pending_confirmation' || appointment.status === 'confirmed',
  );

  const todayPending = active
    .filter(
      (appointment) =>
        appointment.status === 'pending_confirmation' && appointment.appointmentDate === clinicDate,
    )
    .sort(compareStartAscending);

  const missedPending = active
    .filter(
      (appointment) =>
        appointment.status === 'pending_confirmation' && appointment.appointmentDate < clinicDate,
    )
    .sort(compareStartDescending);

  const limit = Number.isFinite(maxNext) ? Math.max(0, Math.trunc(maxNext)) : 3;
  const todayAppointments = active
    .filter((appointment) => appointment.appointmentDate === clinicDate)
    .sort(compareStartAscending)
    .slice(0, limit);

  return { todayPending, missedPending, todayAppointments };
}
