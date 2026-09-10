import type { BookingCollected } from '../booking/collected';
import { hasBookingProgress, inferBookingState } from '../booking/booking-progress';
import { BOOKING_FLOW } from '../booking/states';

import { expectedFieldsForState } from './active-state-context';

export type ReceptionistAgentBookingContextInput = {
  messageText: string;
  languageCode: string;
  collected: BookingCollected;
  patientPhone?: string | null;
  lastAssistantMessageText?: string | null;
};

export type ReceptionistAgentBookingContext = {
  in_booking: boolean;
  flow: typeof BOOKING_FLOW;
  state: string;
  expected_fields: string[];
  missing_fields: string[];
  next_action: string;
  example_reply: string;
  reply_rules: string[];
  tool_hints: string[];
  patient_move?: string;
};

const NEXT_ACTION_BY_STATE: Record<
  string,
  { action: string; example_ta: string; example_en: string; tools: string[] }
> = {
  ASK_PROBLEM_OR_DOCTOR: {
    action: 'ask_reason_or_doctor',
    example_ta: 'Endha doctor-a paakanum? Illena enna problem-ku appointment venum?',
    example_en: 'Which doctor would you like to see, or what problem do you need help with?',
    tools: ['update_booking_state'],
  },
  ASK_REASON: {
    action: 'ask_reason',
    example_ta: 'Enna problem-ku appointment venum?',
    example_en: 'What problem do you need the appointment for?',
    tools: ['update_booking_state'],
  },
  ASK_DATE: {
    action: 'ask_preferred_date',
    example_ta: 'Enna date-ku appointment venum?',
    example_en: 'Which date would you like the appointment for?',
    tools: ['update_booking_state'],
  },
  ASK_TIME: {
    action: 'ask_time_preference',
    example_ta: 'Morning, afternoon, illena evening — edha prefer panreenga?',
    example_en: 'Do you prefer morning, afternoon, or evening?',
    tools: ['update_booking_state', 'check_slot_availability'],
  },
  PROPOSE_SLOTS: {
    action: 'check_slots_and_offer',
    example_ta: 'Available slots check pannitu edha choose panreenga-nu kelunga.',
    example_en: 'Call check_slot_availability, then offer real slots and ask which one they prefer.',
    tools: ['check_slot_availability', 'update_booking_state'],
  },
  ASK_PATIENT_NAME: {
    action: 'ask_patient_name',
    example_ta: 'Patient name sollunga.',
    example_en: 'Please share the patient name.',
    tools: ['update_booking_state'],
  },
  CONFIRM_DOCTOR: {
    action: 'confirm_booking',
    example_ta: 'Details correct-a? Book pannalama?',
    example_en: 'Should I go ahead and book this appointment?',
    tools: ['create_appointment_request'],
  },
  AWAITING_CONFIRMATION: {
    action: 'inform_pending',
    example_ta: 'Unga appointment pending confirmation-la irukku. Staff confirm panna odane confirm aagidum.',
    example_en: 'Your appointment is pending confirmation. Once the staff confirms, it will be confirmed.',
    tools: [],
  },
};

const BOOKING_REPLY_RULES: string[] = [
  'Ask exactly ONE short question this turn — never a numbered list of all required fields.',
  'If patient_message contains any booking field (reason, doctor, date, time, name, phone), call update_booking_state first, then ask only the next missing field.',
  'Offer times only from check_slot_availability — never invent slots or doctors.',
  'Book with create_appointment_request only after explicit patient yes (confirmedByPatient=true).',
];

function listMissingBookingFields(
  collected: BookingCollected,
  patientPhone?: string | null,
): string[] {
  const missing: string[] = [];
  if (!collected.reason_for_visit && !collected.doctor_id) {
    missing.push('reason_or_doctor');
  }
  if (collected.doctor_id && !collected.reason_for_visit) {
    missing.push('reason_for_visit');
  }
  if (!collected.preferred_date) {
    missing.push('preferred_date');
  }
  if (!collected.time_preference && !collected.selected_slot_id && !collected.hold_id) {
    missing.push('time_preference_or_slot');
  }
  if (!collected.selected_slot_id && !collected.hold_id) {
    missing.push('confirmed_slot');
  }
  if (!collected.patient_name) {
    missing.push('patient_name');
  }
  const phoneKnown = Boolean(
    patientPhone ||
      (collected as Record<string, unknown>).patient_phone ||
      (collected as Record<string, unknown>).known_patient_phone,
  );
  if (!phoneKnown) {
    missing.push('patient_phone');
  }
  return missing;
}

function isBookingMetaQuestion(messageText: string): boolean {
  const text = messageText.toLowerCase();
  return (
    /few more details/.test(text) ||
    /need more details/.test(text) ||
    /what (details|information) (do you|you) need/.test(text) ||
    /what do you need/.test(text) ||
    /what (all )?details/.test(text) ||
    /enna details/.test(text) ||
    /details venum/.test(text)
  );
}

function isLikelyBookingIntent(messageText: string, collected: BookingCollected): boolean {
  if (hasBookingProgress(collected)) {
    return true;
  }
  if (isBookingMetaQuestion(messageText)) {
    return true;
  }
  const text = messageText.toLowerCase();
  return (
    /appointment/.test(text) ||
    /\bbook/.test(text) ||
    /slot/.test(text) ||
    /paakanum/.test(text) ||
    /venum/.test(text) ||
    /pain/.test(text) ||
    /fever/.test(text)
  );
}

export function buildReceptionistAgentBookingContext(
  input: ReceptionistAgentBookingContextInput,
): ReceptionistAgentBookingContext | null {
  if (!isLikelyBookingIntent(input.messageText, input.collected)) {
    return null;
  }

  const state = inferBookingState(input.collected);
  const guide =
    NEXT_ACTION_BY_STATE[state] ?? NEXT_ACTION_BY_STATE.ASK_PROBLEM_OR_DOCTOR!;
  const useTamil = input.languageCode !== 'english';
  const patientMove = isBookingMetaQuestion(input.messageText)
    ? 'meta_question_what_details_needed'
    : undefined;

  const replyRules = [...BOOKING_REPLY_RULES];
  if (patientMove === 'meta_question_what_details_needed') {
    replyRules.unshift(
      'Patient is asking what details YOU need from them — answer briefly and ask ONLY the single next field (next_action), not the full checklist.',
    );
  }

  return {
    in_booking: true,
    flow: BOOKING_FLOW,
    state,
    expected_fields: expectedFieldsForState(BOOKING_FLOW, state),
    missing_fields: listMissingBookingFields(input.collected, input.patientPhone),
    next_action: guide.action,
    example_reply: useTamil ? guide.example_ta : guide.example_en,
    reply_rules: replyRules,
    tool_hints: guide.tools,
    ...(patientMove ? { patient_move: patientMove } : {}),
  };
}
