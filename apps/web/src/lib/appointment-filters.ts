import type { Appointment, AppointmentActivity } from '@/components/pages/appointments/types';

export const APPOINTMENT_ACTIVITY_RETENTION_DAYS = 3;

function shiftIsoDate(date: string, days: number): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return date;
  }

  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return shifted.toISOString().slice(0, 10);
}

function dateInTimezone(value: Date, timezone: string): string | null {
  if (Number.isNaN(value.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function compareAppointmentStart(left: Appointment, right: Appointment): number {
  const byStart = `${left.appointmentDate}T${left.appointmentTime}`.localeCompare(
    `${right.appointmentDate}T${right.appointmentTime}`,
  );
  return byStart || left.id.localeCompare(right.id);
}

function compareAppointmentStartDescending(left: Appointment, right: Appointment): number {
  const byStart = `${right.appointmentDate}T${right.appointmentTime}`.localeCompare(
    `${left.appointmentDate}T${left.appointmentTime}`,
  );
  return byStart || left.id.localeCompare(right.id);
}

/**
 * Pending confirmations are actionable only on or after the clinic's current
 * calendar date. Appointment dates are clinic-local YYYY-MM-DD values, so a
 * lexical comparison avoids accidentally applying the browser's timezone.
 */
export function filterCurrentAndFuturePendingAppointments<T extends Appointment>(
  appointments: readonly T[],
  clinicDate: string,
): T[] {
  return appointments
    .filter(
      (appointment) =>
        appointment.status === 'pending_confirmation' && appointment.appointmentDate >= clinicDate,
    )
    .sort(compareAppointmentStart);
}

/**
 * Past pending confirmations are no longer actionable and belong in missed
 * actions. Most recently missed appointments are returned first.
 */
export function filterMissedPendingAppointments<T extends Appointment>(
  appointments: readonly T[],
  clinicDate: string,
): T[] {
  const retentionStartDate = shiftIsoDate(clinicDate, -APPOINTMENT_ACTIVITY_RETENTION_DAYS);

  return appointments
    .filter(
      (appointment) =>
        appointment.status === 'pending_confirmation' &&
        appointment.appointmentDate < clinicDate &&
        appointment.appointmentDate >= retentionStartDate,
    )
    .sort(compareAppointmentStartDescending);
}

/**
 * Cancellation history is retained for three clinic-calendar days after the
 * cancellation. Reschedule history is retained through three days after the
 * appointment's latest scheduled date.
 */
export function filterRetainedAppointmentActivities<T extends AppointmentActivity>(
  activities: readonly T[],
  clinicDate: string,
  clinicTimezone: string,
): T[] {
  const retentionStartDate = shiftIsoDate(clinicDate, -APPOINTMENT_ACTIVITY_RETENTION_DAYS);

  return activities.filter((activity) => {
    if (activity.actionType === 'reschedule') {
      return activity.appointmentDate >= retentionStartDate;
    }

    const cancellationDate = dateInTimezone(new Date(activity.occurredAt), clinicTimezone);
    return cancellationDate !== null && cancellationDate >= retentionStartDate;
  });
}

/**
 * Confirmed appointments remain upcoming only while their clinic-local date is
 * today or later. They are returned in chronological order.
 */
export function filterCurrentAndFutureConfirmedAppointments<T extends Appointment>(
  appointments: readonly T[],
  clinicDate: string,
): T[] {
  return appointments
    .filter(
      (appointment) =>
        appointment.status === 'confirmed' && appointment.appointmentDate >= clinicDate,
    )
    .sort(compareAppointmentStart);
}
