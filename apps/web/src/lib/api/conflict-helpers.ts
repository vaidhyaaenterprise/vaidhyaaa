import { ApiRequestError } from '@/lib/api/client';
import type { ScheduleConflictItem } from '@/lib/api/clinic-subscription';

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

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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

export function formatScheduleConflicts(conflicts: ScheduleConflictItem[]): string[] {
  return conflicts.map((conflict) => {
    if (conflict.reason === 'outside_clinic_hours') {
      return `Appointment ${conflict.appointment_id ?? 'unknown'} falls outside new clinic hours`;
    }
    if (conflict.reason === 'active_appointment_on_holiday') {
      return `Active appointment ${conflict.appointment_id ?? 'unknown'} on ${conflict.holiday_date ?? 'holiday'}`;
    }
    if (conflict.reason === 'occupied_exceeds_new_capacity') {
      const slotRange = formatSlotRange(conflict);
      if (slotRange) {
        return `Slot ${slotRange} has more bookings than the new capacity allows`;
      }
      return `Slot ${conflict.slot_id ?? 'unknown'} has more bookings than the new capacity allows`;
    }
    if (conflict.reason === 'future_occupancy_blocks_duration_change') {
      const slotRange = formatSlotRange(conflict);
      if (slotRange) {
        return `Slot ${slotRange} has future bookings blocking duration change`;
      }
      return `Slot ${conflict.slot_id ?? 'unknown'} has future bookings blocking duration change`;
    }
    return `${conflict.reason}${conflict.appointment_id ? ` (${conflict.appointment_id})` : ''}`;
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
  return formatScheduleConflicts(raw as ScheduleConflictItem[]);
}
