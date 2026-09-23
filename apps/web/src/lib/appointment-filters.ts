import type { Appointment } from '@/components/pages/appointments/types';

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
        appointment.status === 'pending_confirmation' &&
        appointment.appointmentDate >= clinicDate,
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
  return appointments
    .filter(
      (appointment) =>
        appointment.status === 'pending_confirmation' &&
        appointment.appointmentDate < clinicDate,
    )
    .sort(compareAppointmentStartDescending);
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
