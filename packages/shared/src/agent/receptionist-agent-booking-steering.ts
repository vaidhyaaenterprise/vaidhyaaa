import type { BookingCollected } from '../booking/collected';
import { inferBookingState } from '../booking/booking-progress';

import {
  extractActiveDoctorName,
  extractActivePreferredDate,
  extractActiveReasonForVisit,
  extractActiveTimePreference,
} from './active-state-parsers';
import {
  buildReceptionistAgentBookingContext,
  type ReceptionistAgentBookingContext,
} from './receptionist-agent-booking-context';

export type AgentBookingFieldPatch = Partial<{
  reason_for_visit: string;
  doctor_name: string;
  preferred_date: string;
  time_preference: 'morning' | 'afternoon' | 'evening';
  patient_name: string;
  patient_phone: string;
}>;

export function extractAgentBookingFieldPatch(input: {
  messageText: string;
  collected: BookingCollected;
  referenceDate: string;
}): AgentBookingFieldPatch {
  const text = input.messageText.trim();
  if (!text) {
    return {};
  }

  const patch: AgentBookingFieldPatch = {};
  const reason = extractActiveReasonForVisit(text);
  const doctor = extractActiveDoctorName(text);
  const date = extractActivePreferredDate(text, input.referenceDate);
  const timePreference = extractActiveTimePreference(text);
  const patientName = extractActivePatientName(text);

  if (reason && !input.collected.reason_for_visit) {
    patch.reason_for_visit = reason;
  }
  if (doctor && !input.collected.doctor_name && !input.collected.doctor_id) {
    patch.doctor_name = doctor;
  }
  if (date) {
    patch.preferred_date = date;
  }
  if (timePreference) {
    patch.time_preference = timePreference;
  }
  if (patientName && !input.collected.patient_name) {
    patch.patient_name = patientName;
  }

  return patch;
}

function extractActivePatientName(text: string): string | null {
  if (/^\s*(?:dr\.?|doctor)\s+/i.test(text)) {
    return null;
  }
  if (extractActivePreferredDate(text, '2000-01-01') || extractActiveTimePreference(text)) {
    return null;
  }
  const normalized = text.trim();
  const introMatch = normalized.match(/\b(?:naan|i am|i'm|my name is)\s+([a-z][a-z\s]{1,30})$/i);
  if (introMatch?.[1]) {
    return introMatch[1].trim();
  }
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?$/.test(normalized) && normalized.split(/\s+/).length <= 2) {
    return normalized;
  }
  return null;
}

export function isMultiQuestionBookingDump(replyText: string): boolean {
  const text = replyText.trim();
  if (!text) {
    return false;
  }

  const questionMarks = (text.match(/\?/g) ?? []).length;
  if (questionMarks >= 2) {
    return true;
  }

  const checklistMarkers = (text.match(/\b\d+\.\s|\*\*/g) ?? []).length;
  if (checklistMarkers >= 2) {
    return true;
  }

  const fieldSignals = [
    /\bfull name\b/i,
    /\bpatient name\b/i,
    /\bphone\b/i,
    /\bcontact number\b/i,
    /\bpreferred date\b/i,
    /\btime preference\b/i,
    /\bmorning\b/i,
    /\bafternoon\b/i,
    /\bevening\b/i,
    /\bdoctor\b/i,
    /\bspecialist\b/i,
  ];
  let hits = 0;
  for (const pattern of fieldSignals) {
    if (pattern.test(text)) {
      hits += 1;
    }
  }
  return hits >= 3 || (hits >= 2 && text.length > 120);
}

export function shouldSteerBookingReply(input: {
  replyText: string;
  bookingContext: ReceptionistAgentBookingContext | null;
}): boolean {
  if (!input.bookingContext) {
    return false;
  }
  return isMultiQuestionBookingDump(input.replyText);
}

export function resolveBookingGuidedReply(
  bookingContext: ReceptionistAgentBookingContext,
  collected: BookingCollected,
): string {
  const state = inferBookingState(collected);
  if (state === 'ASK_DATE' && collected.reason_for_visit) {
    return bookingContext.example_reply;
  }
  if (state === 'ASK_REASON' && (collected.doctor_name || collected.doctor_id)) {
    return bookingContext.example_reply;
  }
  return bookingContext.example_reply;
}

export function buildBookingContextForCollected(input: {
  messageText: string;
  languageCode: string;
  collected: BookingCollected;
  patientPhone?: string | null;
  lastAssistantMessageText?: string | null;
}): ReceptionistAgentBookingContext | null {
  return buildReceptionistAgentBookingContext(input);
}
