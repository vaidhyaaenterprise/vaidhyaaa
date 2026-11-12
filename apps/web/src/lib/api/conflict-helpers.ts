import { ApiRequestError } from '@/lib/api/client';
import { scheduleConflictItemSchema, type ScheduleConflictItem } from '@vaidya/shared';
import { dayLabel } from '@/lib/clinic-scheduling';

function formatTime(time: string): string {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function formatClinicLocalTimestamp(value?: string): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.includes('T') ? value.replace('T', ' ') : value;
  const [datePart = '', timePart = '00:00:00'] = normalized.split(' ');
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = datePart
    .split('-')
    .map((piece) => Number.parseInt(piece, 10));
  const [hours = Number.NaN, minutes = Number.NaN] = timePart
    .split(':')
    .map((piece) => Number.parseInt(piece, 10));
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(hours) ||
    Number.isNaN(minutes)
  ) {
    return normalized.slice(0, 16);
  }

  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthName = monthNames[month - 1] ?? String(month).padStart(2, '0');
  return `${day} ${monthName} ${year} at ${formatTime(`${hours}:${minutes}`)}`;
}

function formatSlotRange(conflict: ScheduleConflictItem): string | null {
  const startLabel = formatClinicLocalTimestamp(conflict.slot_start);
  if (!startLabel) {
    return null;
  }
  const endLabel = formatClinicLocalTimestamp(conflict.slot_end);
  if (!endLabel) {
    return startLabel;
  }

  const endTime = endLabel.split(' at ')[1] ?? '';
  return `${startLabel} - ${endTime}`;
}

function formatAppointmentSummary(conflict: ScheduleConflictItem): string {
  const appointment = conflict.appointment;
  if (!appointment) {
    return 'A patient has an existing appointment.';
  }

  const when = formatClinicLocalTimestamp(appointment.appointment_start);
  return `${appointment.patient_name} has booked an appointment${when ? ` on ${when}` : ''}${appointment.doctor_name ? ` with ${appointment.doctor_name}` : ''}.`;
}

export function formatScheduleConflicts(conflicts: readonly unknown[]): string[] {
  return conflicts.map((rawConflict) => {
    const parsed = scheduleConflictItemSchema.safeParse(rawConflict);
    if (!parsed.success) {
      return 'This schedule change conflicts with existing bookings';
    }
    const conflict: ScheduleConflictItem = parsed.data;

    if (conflict.reason === 'doctor_schedule_outside_clinic_hours' && conflict.doctor_schedule) {
      const schedule = conflict.doctor_schedule;
      return `${schedule.doctor_name} is available on ${dayLabel(schedule.day_of_week)} from ${formatTime(schedule.start_time)} to ${formatTime(schedule.end_time)}, outside clinic working hours. Adjust the doctor's working hours, or use Holiday setup for a closure on a particular date.`;
    }

    if (conflict.reason === 'outside_clinic_hours') {
      return `${formatAppointmentSummary(conflict)} These clinic hours would exclude the appointment.`;
    }
    if (conflict.reason === 'outside_doctor_hours') {
      return `${formatAppointmentSummary(conflict)} These doctor working hours would exclude the appointment.`;
    }
    if (conflict.reason === 'active_appointment_on_holiday') {
      return `${formatAppointmentSummary(conflict)} The selected holiday conflicts with this appointment.`;
    }
    if (conflict.reason === 'occupied_exceeds_new_capacity') {
      const slotRange = formatSlotRange(conflict);
      if (slotRange) {
        return `Slot ${slotRange} has more bookings than the new capacity allows`;
      }
      return 'A future booked slot has more appointments than the new capacity allows';
    }
    if (conflict.reason === 'future_occupancy_blocks_duration_change') {
      const slotRange = formatSlotRange(conflict);
      if (slotRange) {
        return `Slot ${slotRange} has future bookings blocking duration change`;
      }
      return 'A future booked slot has appointments that block the duration change';
    }
    if (conflict.appointment || conflict.appointment_id) {
      return `${formatAppointmentSummary(conflict)} Please reschedule it before making this change.`;
    }
    return 'This schedule change conflicts with existing bookings';
  });
}

export function conflictsFromApiError(err: unknown): string[] | null {
  if (!(err instanceof ApiRequestError)) {
    return null;
  }
  if (err.apiError.code !== 'CONFLICTING_APPOINTMENTS') {
    return null;
  }
  const raw = err.apiError.details?.conflicts;
  if (!Array.isArray(raw)) {
    return [err.apiError.message];
  }
  return formatScheduleConflicts(raw);
}
