import type { Appointment } from '@/components/pages/appointments/types';

function compareAppointmentStart(left: Appointment, right: Appointment): number {
  const byStart = `${left.appointmentDate}T${left.appointmentTime}`.localeCompare(
    `${right.appointmentDate}T${right.appointmentTime}`,
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
