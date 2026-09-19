import { ApiRequestError } from '@/lib/api/client';
import { scheduleConflictItemSchema, type ScheduleConflictItem } from '@vaidya/shared';

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
  return `${day} ${monthName} ${year} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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

  const endTime = endLabel.split(' ').slice(-1)[0] ?? '';
  return `${startLabel} - ${endTime}`;
}

function formatAppointmentRange(conflict: ScheduleConflictItem): string | null {
  const appointment = conflict.appointment;
  if (!appointment) {
    return null;
  }
  const startLabel = formatClinicLocalTimestamp(appointment.appointment_start);
  if (!startLabel) {
    return null;
  }
  const endLabel = formatClinicLocalTimestamp(appointment.appointment_end);
  if (!endLabel) {
    return startLabel;
  }
  const endTime = endLabel.split(' ').slice(-1)[0] ?? '';
  return `${startLabel} - ${endTime}`;
}

function humanizeStatus(status: string): string {
  return status
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatAppointmentSummary(conflict: ScheduleConflictItem): string {
  const appointment = conflict.appointment;
  if (!appointment) {
    return 'An existing appointment';
  }

  const details = [appointment.patient_name];
  const range = formatAppointmentRange(conflict);
  if (range) {
    details.push(range);
  }
  if (appointment.doctor_name) {
    details.push(`Doctor: ${appointment.doctor_name}`);
  }
  if (appointment.service_name) {
    details.push(`Service: ${appointment.service_name}`);
  }
  details.push(`Status: ${humanizeStatus(appointment.status)}`);
  return details.join(' • ');
}

export function formatScheduleConflicts(conflicts: readonly unknown[]): string[] {
  return conflicts.map((rawConflict) => {
    const parsed = scheduleConflictItemSchema.safeParse(rawConflict);
    if (!parsed.success) {
      return 'This schedule change conflicts with existing bookings';
    }
    const conflict: ScheduleConflictItem = parsed.data;

    if (conflict.reason === 'outside_clinic_hours') {
      return `${formatAppointmentSummary(conflict)} — falls outside the new clinic hours`;
    }
    if (conflict.reason === 'outside_doctor_hours') {
      return `${formatAppointmentSummary(conflict)} — falls outside the doctor's new working hours`;
    }
    if (conflict.reason === 'active_appointment_on_holiday') {
      return `${formatAppointmentSummary(conflict)} — conflicts with the proposed holiday`;
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
      return `${formatAppointmentSummary(conflict)} — conflicts with this schedule change`;
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
