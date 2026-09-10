import { applyReasonForVisitUpdate, type BookingCollected } from '@vaidya/shared';
import type { ExtractedBookingFields, TimePreference } from '@vaidya/shared';

export type { ExtractedBookingFields, TimePreference };

const TIME_PREFERENCE_ORDER: TimePreference[] = ['morning', 'afternoon', 'evening'];

const TIME_PREFERENCE_LABELS: Record<TimePreference, string> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
};

export function mergeCollected(
  current: BookingCollected,
  extracted: ExtractedBookingFields,
): BookingCollected {
  const base = extracted.reason_for_visit
    ? applyReasonForVisitUpdate(current, extracted.reason_for_visit)
    : current;

  return {
    ...base,
    ...(extracted.doctor_id ? { doctor_id: extracted.doctor_id } : {}),
    ...(extracted.doctor_name ? { doctor_name: extracted.doctor_name } : {}),
    ...(extracted.clinic_service_id ? { clinic_service_id: extracted.clinic_service_id } : {}),
    ...(extracted.routing_source ? { routing_source: extracted.routing_source } : {}),
    ...(extracted.preferred_date ? { preferred_date: extracted.preferred_date } : {}),
    ...(extracted.time_preference ? { time_preference: extracted.time_preference } : {}),
    ...(extracted.proposed_slots ? { proposed_slots: extracted.proposed_slots } : {}),
    ...(extracted.selected_slot_id ? { selected_slot_id: extracted.selected_slot_id } : {}),
    ...(extracted.hold_id ? { hold_id: extracted.hold_id } : {}),
    ...(extracted.patient_name ? { patient_name: extracted.patient_name } : {}),
    ...(extracted.patient_id ? { patient_id: extracted.patient_id } : {}),
    ...(extracted.is_followup !== undefined ? { is_followup: extracted.is_followup } : {}),
    ...(extracted.appointment_id ? { appointment_id: extracted.appointment_id } : {}),
    ...(extracted.pending_patient_candidates
      ? { pending_patient_candidates: extracted.pending_patient_candidates }
      : {}),
  };
}

export function applyExtractedToCollected(
  collected: BookingCollected,
  extracted: ExtractedBookingFields,
): BookingCollected {
  const next = { ...collected };
  const dateOnly =
    extracted.preferred_date &&
    !extracted.time_preference &&
    !extracted.selected_time;

  if (extracted.preferred_date) {
    next.preferred_date = extracted.preferred_date;
  }
  if (extracted.time_preference) {
    next.time_preference = extracted.time_preference;
  } else if (dateOnly) {
    delete next.time_preference;
  }

  delete next.awaiting_alternate_slot;
  delete next.proposed_slots;
  delete next.selected_slot_id;
  delete next.hold_id;
  return next;
}

export function slotHour(startTime: string): number {
  const timePart = startTime.includes(' ') ? (startTime.split(' ')[1] ?? startTime) : startTime;
  return Number(timePart.split(':')[0] ?? 0);
}

export function slotMatchesTimePreference(
  startTime: string,
  timePreference: TimePreference,
): boolean {
  const hour = slotHour(startTime);
  if (timePreference === 'morning') {
    return hour < 12;
  }
  if (timePreference === 'afternoon') {
    return hour >= 12 && hour < 17;
  }
  return hour >= 17;
}

export function getAvailableTimePreferencesForDate<
  T extends { start_time: string; available_count?: number },
>(slots: T[], preferredDate: string): TimePreference[] {
  const available = TIME_PREFERENCE_ORDER.filter((preference) =>
    slots.some((slot) => {
      const datePart = slot.start_time.split(' ')[0];
      return (
        datePart === preferredDate &&
        (slot.available_count ?? 1) > 0 &&
        slotMatchesTimePreference(slot.start_time, preference)
      );
    }),
  );
  return available;
}

export function formatTimeOptions(preferences: TimePreference[]): string {
  if (preferences.length === 0) {
    return 'morning, afternoon, illa evening';
  }
  if (preferences.length === 1) {
    return TIME_PREFERENCE_LABELS[preferences[0]!];
  }
  if (preferences.length === 2) {
    return `${TIME_PREFERENCE_LABELS[preferences[0]!]}, illa ${TIME_PREFERENCE_LABELS[preferences[1]!]}`;
  }
  return 'morning, afternoon, illa evening';
}

export function slotDisplayTime(startTime: string): string {
  const timePart = startTime.includes(' ') ? (startTime.split(' ')[1] ?? startTime) : startTime;
  const [hourRaw, minuteRaw] = timePart.split(':');
  const hour = Number(hourRaw ?? 0);
  const minute = Number(minuteRaw ?? 0);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')}`;
}

export function slotMatchesTimeSelection(
  startTime: string,
  selection: string,
  timePreference?: BookingCollected['time_preference'],
): boolean {
  const timePart = startTime.includes(' ') ? (startTime.split(' ')[1] ?? '') : startTime;
  const [hourRaw, minuteRaw] = timePart.split(':');
  const slotHourValue = Number(hourRaw ?? 0);
  const slotMinute = Number(minuteRaw ?? 0);

  const match = selection.match(/(\d{1,2})[:.](\d{2})/);
  if (!match) {
    return false;
  }

  let selectedHour = Number(match[1]);
  const selectedMinute = Number(match[2]);
  if (selectedHour < 12 && (timePreference === 'evening' || slotHourValue >= 12)) {
    selectedHour += 12;
  }

  return slotHourValue === selectedHour && slotMinute === selectedMinute;
}

export function filterSlotsByDateAndPreference<
  T extends { start_time: string; available_count?: number },
>(slots: T[], preferredDate?: string, timePreference?: BookingCollected['time_preference'], referenceDate?: string, referenceTime?: string): T[] {
  return slots.filter((slot) => {
    if ((slot.available_count ?? 1) <= 0) {
      return false;
    }
    const datePart = slot.start_time.split(' ')[0];
    if (preferredDate && datePart !== preferredDate) {
      return false;
    }
    if (timePreference && !slotMatchesTimePreference(slot.start_time, timePreference)) {
      return false;
    }
    if (referenceDate && referenceTime && datePart === referenceDate) {
      const slotTime = slot.start_time.split(' ')[1] ?? '00:00:00';
      if (slotTime < referenceTime) {
        return false;
      }
    }
    return true;
  });
}

export function formatSlotList(slots: Array<{ display_time: string }>): string {
  return slots.map((slot) => slot.display_time).join(', ');
}

export function formatDateDisplay(dateStr: string): string {
  return dateStr;
}
