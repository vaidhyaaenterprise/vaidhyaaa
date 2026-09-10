import { detectMessageSafety } from './message-safety';
import { detectActiveScopeRedirect } from './receptionist-scope-policy';
import { detectActiveSideQuestion } from './active-state-parsers';
import {
  extractActiveDoctorName,
  extractActivePreferredDate,
  extractActiveReasonForVisit,
  extractActiveTimePreference,
  isActiveAffirmative,
  isActiveDeclining,
} from './active-state-parsers';
import type { ReceptionistDialogCapability } from './receptionist-dialog-types';

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Clinic topics that make an information request specific, not vague. */
const SPECIFIC_CLINIC_TOPIC_PATTERN =
  /\b(fee|fees|evlo|cost|charge|timing|timings|open|close|closed|location|address|enga|parking|insurance|cashless|doctor|dr\.?|available|availability|slot|token|fasting|scan|mri|x-?ray|report|document|visit|follow[- ]?up)\b/i;

const INFORMATION_WORD_PATTERN =
  /\b(detail|details|information|info|doubt|question|clarification|explain|explanation)\b/i;

const INFORMATION_SEEKING_INTENT_PATTERN =
  /\b(need|want|require|wondering|curious|like to know|would like|tell me|give me|share|provide|looking for|ask about|asking about|help with|help me|theva|venum|sollunga|theriyanum|pathi|edhavadhu)\b/i;

const VAGUE_MODIFIER_PATTERN =
  /\b(some|other|another|more|few|any|little|bit|else|different|general|basic|oru|konjam|vera|innum|edhavadhu)\b/i;

export function isThanksOrClosing(text: string): boolean {
  const n = normalize(text);
  return (
    /^(thanks|thank you|thankyou|nandri|done|okay|ok|seri|sari|super|fine|cool|great)\.?$/i.test(n) ||
    /\b(thanks|thank you|nandri)\b/i.test(n)
  );
}

/**
 * Detects when the patient wants clinic information but has not named what
 * they need (fees, timing, location, etc.). Category-based — not a phrase list.
 */
export function isVagueInformationRequest(text: string): boolean {
  const n = normalize(text);
  if (!n) {
    return false;
  }

  // A clear side question already names the topic.
  if (detectSideQuestionCapability(text)) {
    return false;
  }

  // Symptom / visit reason answers are booking answers, not vague info requests.
  if (extractActiveReasonForVisit(text) && !INFORMATION_WORD_PATTERN.test(n)) {
    return false;
  }

  const mentionsInformation = INFORMATION_WORD_PATTERN.test(n);
  const seeksInformation = INFORMATION_SEEKING_INTENT_PATTERN.test(n);
  const vagueModifier = VAGUE_MODIFIER_PATTERN.test(n);
  const namesSpecificTopic = SPECIFIC_CLINIC_TOPIC_PATTERN.test(n);

  // "I need other details", "need some more information", "vera details venum"
  if (mentionsInformation && (seeksInformation || vagueModifier)) {
    if (namesSpecificTopic && !vagueModifier) {
      return false;
    }
    return true;
  }

  // "I need other details" / "need something else" without the word "details"
  if (seeksInformation && vagueModifier && !namesSpecificTopic) {
    return true;
  }

  // Generic help-seeking without naming a clinic topic.
  if (
    /\b(what (else|other)|anything else|something else|help me with something|not sure what to ask)\b/i.test(
      n,
    )
  ) {
    return true;
  }

  if (/\b(i have|got) (a |an )?(doubt|question)\b/i.test(n)) {
    return !namesSpecificTopic;
  }

  if (/\b(can you help|could you help|need help)\b/i.test(n) && !namesSpecificTopic) {
    return true;
  }

  return false;
}

export function isHumanStaffRequest(text: string): boolean {
  const n = normalize(text);
  return (
    /\b(receptionist|human agent|human staff|staff call|call back|callback|person kitta|kitta pesanum|talk to (staff|person|human))\b/i.test(
      n,
    )
  );
}

export function isComplaintOrFrustration(text: string): boolean {
  const n = normalize(text);
  return /\b(frustrat|waste|worst|useless|puriyala|not working|bot)\b/i.test(n);
}

export function detectSideQuestionCapability(text: string): ReceptionistDialogCapability | null {
  const side = detectActiveSideQuestion(text);
  if (!side) {
    return null;
  }
  const map: Record<string, ReceptionistDialogCapability> = {
    ask_fee: 'ask_fee',
    ask_timing: 'ask_timing',
    ask_location: 'ask_location',
    ask_doctor_availability: 'ask_doctor_availability',
    ask_previsit_instruction: 'ask_previsit_instruction',
    ask_insurance: 'ask_insurance',
    ask_human_agent: 'ask_human_agent',
  };
  return map[side.intent] ?? 'ask_previsit_instruction';
}

export function isBookingIntent(text: string): boolean {
  const n = normalize(text);
  return (
    /\b(appointment|book pannunga|paakanum|token venum|schedule)\b/i.test(n) ||
    Boolean(extractActiveReasonForVisit(text))
  );
}

export function isLifecycleIntent(text: string): ReceptionistDialogCapability | null {
  const n = normalize(text);
  if (/\b(cancel pannunga|cancel appointment|appointment cancel)\b/i.test(n) || /\bcancel\b/i.test(n)) {
    return 'cancel_appointment';
  }
  if (/\b(reschedule|time change|change panna venum)\b/i.test(n)) {
    return 'reschedule_appointment';
  }
  return null;
}

export function isCorrectionUtterance(text: string): boolean {
  const n = normalize(text);
  return (
    /\b(not |illa,? |change to |instead of )\b/i.test(n) ||
    /\bdr\.?\s+\w+\s+illa\b/i.test(n)
  );
}

export function extractDialogEntities(text: string, referenceDate: string) {
  return {
    reasonForVisit: extractActiveReasonForVisit(text),
    doctorName: extractActiveDoctorName(text),
    date: extractActivePreferredDate(text, referenceDate),
    timePreference: extractActiveTimePreference(text),
    topic: text.trim(),
  };
}

export function detectDialogSafety(text: string) {
  return detectMessageSafety(text);
}

export function isOutOfScopeUtterance(text: string): boolean {
  return detectActiveScopeRedirect(text);
}

export function isConfirmationUtterance(text: string): boolean {
  return isActiveAffirmative(text);
}

export function isRejectionUtterance(text: string): boolean {
  return isActiveDeclining(text);
}

export function isGreetingUtterance(text: string): boolean {
  const n = normalize(text);
  if (isBookingIntent(text)) {
    return false;
  }
  return /^(hi+|hello+|hey+|vanakkam|good morning|good evening|namaste)\b/i.test(n);
}
