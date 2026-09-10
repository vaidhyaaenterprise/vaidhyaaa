import type { ExtractedBookingFields } from './extracted-fields';
import type { BookingCollected } from './collected';
import {
  extractActivePreferredDate,
  extractActiveReasonForVisit,
  extractActiveTimePreference,
  selectOfferedSlot,
} from '../agent/active-state-parsers';

const REASON_STATES = new Set(['BOOKING_STARTED', 'ASK_PROBLEM_OR_DOCTOR', 'ASK_REASON']);
const DATE_STATES = new Set(['ASK_DATE', 'ASK_NEW_DATE', 'ASK_ALTERNATE_TIME']);
const TIME_STATES = new Set(['ASK_TIME', 'ASK_NEW_TIME']);
const SLOT_STATES = new Set(['PROPOSE_SLOTS', 'PROPOSE_NEW_SLOTS']);

export function enrichExtractedForBookingState(input: {
  stateBefore: string;
  collected: BookingCollected;
  extracted: ExtractedBookingFields;
  messageText: string;
  referenceDate: string;
}): ExtractedBookingFields {
  const next: ExtractedBookingFields = { ...input.extracted };
  const message = input.messageText.trim();
  if (!message) {
    return next;
  }

  if (REASON_STATES.has(input.stateBefore)) {
    const reason = next.reason_for_visit ?? extractActiveReasonForVisit(message);
    if (reason) {
      next.reason_for_visit = reason;
    }
    const date = next.preferred_date ?? extractActivePreferredDate(message, input.referenceDate);
    if (date && !reason) {
      next.preferred_date = date;
    }
  }

  if (DATE_STATES.has(input.stateBefore)) {
    const date = next.preferred_date ?? extractActivePreferredDate(message, input.referenceDate);
    if (date) {
      next.preferred_date = date;
    }
    const timePreference = next.time_preference ?? extractActiveTimePreference(message);
    if (timePreference) {
      next.time_preference = timePreference;
    }
    const reason = next.reason_for_visit ?? extractActiveReasonForVisit(message);
    if (reason && !date) {
      next.reason_for_visit = reason;
    }
  }

  if (TIME_STATES.has(input.stateBefore)) {
    const timePreference = next.time_preference ?? extractActiveTimePreference(message);
    if (timePreference) {
      next.time_preference = timePreference;
    }
  }

  if (SLOT_STATES.has(input.stateBefore) && input.collected.proposed_slots?.length) {
    const selection = selectOfferedSlot(
      message,
      input.collected.proposed_slots.map((slot) => ({
        slotId: slot.slot_id,
        startTime: slot.start_time,
        endTime: slot.end_time,
        displayTime: slot.display_time,
      })),
    );
    if (selection.slotId) {
      const selected = input.collected.proposed_slots.find((slot) => slot.slot_id === selection.slotId);
      if (selected) {
        next.selected_slot_id = selection.slotId;
        next.selected_time = selected.display_time;
      }
    }
  }

  if (!next.reason_for_visit && !input.collected.reason_for_visit && !input.collected.doctor_id) {
    const reason = extractActiveReasonForVisit(message);
    if (reason) {
      next.reason_for_visit = reason;
    }
  }

  if (!next.preferred_date && !input.collected.preferred_date && DATE_STATES.has(input.stateBefore)) {
    const date = extractActivePreferredDate(message, input.referenceDate);
    if (date) {
      next.preferred_date = date;
    }
  }

  return next;
}
