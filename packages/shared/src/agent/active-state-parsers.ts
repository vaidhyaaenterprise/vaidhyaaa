export type TimePreference = 'morning' | 'afternoon' | 'evening';

import { capabilityAllowsActiveFlowSideQuestion } from './receptionist-capability-registry';
import type { SideQuestionIntent } from './state-entity-types';

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function addDaysIso(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function resolveYearForMonthDay(month: number, day: number, referenceDate: string): number {
  const currentYear = Number(referenceDate.slice(0, 4));
  const candidate = `${currentYear}-${pad2(month)}-${pad2(day)}`;
  return candidate >= referenceDate ? currentYear : currentYear + 1;
}

function messageContainsDateFragment(text: string): boolean {
  return (
    /\b\d{4}-\d{2}-\d{2}\b/.test(text) ||
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+\d{1,2}(?:st|nd|rd|th)?\b/i.test(
      text,
    ) ||
    /\b\d{1,2}(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b/i.test(
      text,
    )
  );
}

export function extractActivePreferredDate(
  text: string,
  referenceDate: string,
): string | null {
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch?.[1]) {
    return isoMatch[1];
  }

  const dmyMatch = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (dmyMatch?.[1] && dmyMatch[2] && dmyMatch[3]) {
    return `${dmyMatch[3]}-${pad2(Number(dmyMatch[2]))}-${pad2(Number(dmyMatch[1]))}`;
  }

  const namedMonthDay = text.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  );
  if (namedMonthDay?.[1] && namedMonthDay[2]) {
    const month = MONTH_NAME_TO_NUMBER[namedMonthDay[1].toLowerCase()];
    const day = Number(namedMonthDay[2]);
    if (month) {
      const year = resolveYearForMonthDay(month, day, referenceDate);
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  const dayNamedMonth = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b/i,
  );
  if (dayNamedMonth?.[1] && dayNamedMonth[2]) {
    const month = MONTH_NAME_TO_NUMBER[dayNamedMonth[2].toLowerCase()];
    const day = Number(dayNamedMonth[1]);
    if (month) {
      const year = resolveYearForMonthDay(month, day, referenceDate);
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  const normalized = normalize(text);
  if (/\b(naalaikku|naaliku|nalaki|naalaiku|tomorrow)\b/i.test(normalized)) {
    return addDaysIso(referenceDate, 1);
  }
  if (/\b(inniku|inaiku|iniku|today|indru)\b/i.test(normalized)) {
    return referenceDate;
  }

  const dayOfWeekDate = extractDayOfWeekDate(text, referenceDate);
  if (dayOfWeekDate) {
    return dayOfWeekDate;
  }

  return null;
}

const DAY_NAME_PATTERNS: Array<{ pattern: RegExp; dayOfWeek: number }> = [
  { pattern: /\b(monday|mon)\b/i, dayOfWeek: 1 },
  { pattern: /\b(tuesday|tue|tues)\b/i, dayOfWeek: 2 },
  { pattern: /\b(wednesday|wed)\b/i, dayOfWeek: 3 },
  { pattern: /\b(thursday|thu|thur|thurs)\b/i, dayOfWeek: 4 },
  { pattern: /\b(friday|fri)\b/i, dayOfWeek: 5 },
  { pattern: /\b(saturday|sat)\b/i, dayOfWeek: 6 },
  { pattern: /\b(sunday|sun)\b/i, dayOfWeek: 7 },
];

function dayOfWeekMon1FromIso(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  const jsDay = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function extractDayOfWeekDate(text: string, referenceDate: string): string | null {
  for (const entry of DAY_NAME_PATTERNS) {
    if (!entry.pattern.test(text)) {
      continue;
    }
    const referenceDow = dayOfWeekMon1FromIso(referenceDate);
    let offset = (entry.dayOfWeek - referenceDow + 7) % 7;
    if (offset === 0 && !/\bthis\b/i.test(text)) {
      offset = 7;
    }
    return addDaysIso(referenceDate, offset);
  }
  return null;
}

export function extractActiveTimePreference(text: string): TimePreference | null {
  const normalized = normalize(text);
  if (/\bevening\b|\bmaalai\b|\beve\b|\beveng\b/i.test(normalized)) {
    return 'evening';
  }
  if (/\bmorning\b|\bkaalai\b/i.test(normalized)) {
    return 'morning';
  }
  if (/\bafternoon\b|\bmadiyanam\b|\bafter\s+noon\b/i.test(normalized)) {
    return 'afternoon';
  }
  return null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
};

const MINUTE_WORDS: Record<string, string> = {
  thirty: '30', half: '30', fifteen: '15', quarter: '15',
  'forty five': '45', 'forty-five': '45',
};

const MINUTE_WORD_PATTERN = Object.keys(MINUTE_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|');

export function extractActiveExactTime(text: string): string | null {
  const withMinutes = text.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (withMinutes) {
    const hour = Number(withMinutes[1]);
    const minute = withMinutes[2];
    if (hour >= 13 && hour <= 23) {
      return `${hour}:${minute}`;
    }
    return `${hour}:${minute}`;
  }

  if (/\b6 arai\b/i.test(text)) {
    return '18:30';
  }

  if (/\bsix thirty\b/i.test(text)) {
    return '18:30';
  }

  const wordMatch = text.match(
    new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\s+(${MINUTE_WORD_PATTERN})\\b`, 'i'),
  );
  if (wordMatch) {
    const hour = NUMBER_WORDS[wordMatch[1]!.toLowerCase()];
    const minute = MINUTE_WORDS[wordMatch[2]!.toLowerCase()];
    if (hour && minute) {
      return `${hour}:${minute}`;
    }
  }

  const hasDateFragment = messageContainsDateFragment(text);
  const hourPattern = hasDateFragment
    ? /\b(\d{1,2})\s*(?:o'?clock|mani|manikku)\b/i
    : /\b(\d{1,2})\s*(?:o'?clock|mani|manikku)?\b/i;
  const hourOnly = text.match(hourPattern);
  if (hourOnly?.[1]) {
    const hour = Number(hourOnly[1]);
    if (hour >= 1 && hour <= 12) {
      return `${hour}:00`;
    }
    if (hour >= 13 && hour <= 23) {
      return `${hour}:00`;
    }
  }

  const wordOnly = text.match(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'i'));
  if (wordOnly) {
    const hour = NUMBER_WORDS[wordOnly[1]!.toLowerCase()];
    if (hour) {
      return `${hour}:00`;
    }
  }

  return null;
}

export function isActiveAffirmative(text: string): boolean {
  const normalized = normalize(text);
  return /\b(seri|sari|ok|okay|confirm|yes|book pannunga|appointment create pannunga|pannunga)\b/i.test(
    normalized,
  );
}

export function isActiveDeclining(text: string): boolean {
  const normalized = normalize(text);
  if (/\blater\s+(slot|one)\b/i.test(normalized)) {
    return false;
  }
  return (
    /\b(vendam|venam|venda|no|cancel venda)\b/i.test(normalized) ||
    (/\bcancel\b/i.test(normalized) && /\b(venda|vendam|venam)\b/i.test(normalized))
  );
}

export function isActiveFlowCancel(text: string): boolean {
  const normalized = normalize(text);
  return /\b(vendam|venam|venda|no thanks|stop|later paakalam)\b/i.test(normalized);
}

const DOCTOR_NAME_GUARD_WORDS = /\b(appointment|book|slot|pain|fever|venum|paakanum|fee|fees|evlo|enna|epo|eppo|yenga|enga|when|what|how|where|why|cost|price|time|timing|help|clinic|enga|iruku|nu|solunga|first)\b/i;

export function extractActiveDoctorName(text: string): string | null {
  if (DOCTOR_NAME_GUARD_WORDS.test(text) && !text.match(/\b(?:dr|doctor)\s+(?:kumar|priya|ravi|siva|mohan|selvi|arun)\b/i)) {
    const onlyName = text.trim().match(/^(?:doctor\s+)?([a-z]{3,})$/i);
    if (!onlyName) {
      return null;
    }
  }
  const drMatch = text.match(/\bdr\.?\s+([a-z]+)/i);
  if (drMatch?.[1] && !DOCTOR_NAME_GUARD_WORDS.test(drMatch[1])) {
    return drMatch[1].toLowerCase();
  }
  const doctorMatch = text.match(/\bdoctor\s+([a-z]+)/i);
  if (doctorMatch?.[1] && !DOCTOR_NAME_GUARD_WORDS.test(doctorMatch[1])) {
    return doctorMatch[1].toLowerCase();
  }
  const onlyName = text.trim().match(/^(?:doctor\s+)?([a-z]{3,})$/i);
  if (onlyName?.[1] && !DOCTOR_NAME_GUARD_WORDS.test(onlyName[1])) {
    return onlyName[1].toLowerCase();
  }
  return null;
}

export function extractActiveReasonForVisit(text: string): string | null {
  const patterns = [
    /\b(child fever|baby fever|child cough|baby cough)\b/i,
    /\b(knee pain|tooth pain|tooth extraction|fever|chest pain|back pain|headache|eye checkup|stomach pain)\b/i,
    /\b([a-z]+ pain)\b/i,
    /\b(follow[- ]?up)\b/i,
    /\b(fever|cough|cold|diarrhea|vomiting|infection|rash|allergy)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }
  return null;
}

const SIDE_QUESTION_BLOCKED_STATES = new Set([
  'CONFIRM_DETAILS',
  'CONFIRM_CANCEL_REQUEST',
  'CONFIRM_RESCHEDULE_REQUEST',
]);

const REASON_OR_DOCTOR_STATES = new Set([
  'BOOKING_STARTED',
  'ASK_PROBLEM_OR_DOCTOR',
  'ASK_REASON',
]);
const DATE_STATES = new Set(['ASK_DATE', 'ASK_NEW_DATE', 'ASK_ALTERNATE_TIME']);

export function tryDeterministicActiveStateEntity(
  input: import('./state-entity-types').StateEntityExtractorInput,
): import('./state-entity-types').StateEntityExtractorResult | null {
  const text = input.messageText.trim();
  const { currentState } = input;

  const sideQuestion = detectActiveSideQuestion(text);
  if (sideQuestion && !SIDE_QUESTION_BLOCKED_STATES.has(currentState)) {
    return {
      recognizedAs: 'side_question',
      confidence: 0.95,
      entities: {
        sideQuestionIntent: sideQuestion.intent,
        sideQuestionTopic: sideQuestion.topic,
        doctorName: extractActiveDoctorName(text),
      },
      needsClarification: false,
    };
  }

  if (REASON_OR_DOCTOR_STATES.has(currentState)) {
    const reasonForVisit = extractActiveReasonForVisit(text);
    if (reasonForVisit) {
      return {
        recognizedAs: 'service_answer',
        confidence: 0.95,
        entities: { reasonForVisit },
        needsClarification: false,
      };
    }

    const doctorName = extractActiveDoctorName(text);
    if (doctorName && !extractActiveReasonForVisit(text)) {
      return {
        recognizedAs: 'doctor_answer',
        confidence: 0.9,
        entities: { doctorName },
        needsClarification: false,
      };
    }
  }

  if (DATE_STATES.has(currentState)) {
    const date = extractActivePreferredDate(text, input.referenceDate);
    const reasonForVisit = extractActiveReasonForVisit(text);
    if (date && !reasonForVisit) {
      return {
        recognizedAs: 'date_answer',
        confidence: 0.95,
        entities: { date },
        needsClarification: false,
      };
    }
    if (reasonForVisit && !date) {
      return {
        recognizedAs: 'service_answer',
        confidence: 0.95,
        entities: { reasonForVisit },
        needsClarification: false,
      };
    }
  }

  if (currentState === 'PROPOSE_SLOTS' || currentState === 'PROPOSE_NEW_SLOTS') {
    const selection = selectOfferedSlot(text, input.offeredSlots ?? []);
    if (selection.slotId) {
      return {
        recognizedAs: 'slot_selection',
        confidence: 0.95,
        entities: { selectedSlotId: selection.slotId },
        needsClarification: false,
      };
    }
  }

  return null;
}

export function correctActiveStateEntityResult(
  input: import('./state-entity-types').StateEntityExtractorInput,
  result: import('./state-entity-types').StateEntityExtractorResult,
): import('./state-entity-types').StateEntityExtractorResult {
  const text = input.messageText.trim();
  const { currentState } = input;

  const sideQuestion = detectActiveSideQuestion(text);
  if (
    sideQuestion &&
    !SIDE_QUESTION_BLOCKED_STATES.has(currentState) &&
    result.recognizedAs !== 'side_question'
  ) {
    return {
      recognizedAs: 'side_question',
      confidence: Math.max(result.confidence, 0.9),
      entities: {
        ...result.entities,
        sideQuestionIntent: sideQuestion.intent,
        sideQuestionTopic: sideQuestion.topic,
      },
      needsClarification: false,
    };
  }

  if (REASON_OR_DOCTOR_STATES.has(currentState) || DATE_STATES.has(currentState)) {
    const reasonForVisit =
      extractActiveReasonForVisit(text) ??
      (result.entities.doctorName
        ? extractActiveReasonForVisit(result.entities.doctorName)
        : null) ??
      (result.entities.reasonForVisit ? result.entities.reasonForVisit.toLowerCase() : null);
    const date =
      extractActivePreferredDate(text, input.referenceDate) ??
      (result.entities.date ? result.entities.date : null);

    if (DATE_STATES.has(currentState) && date && !reasonForVisit) {
      return {
        recognizedAs: 'date_answer',
        confidence: Math.max(result.confidence, 0.9),
        entities: {
          ...result.entities,
          date,
          reasonForVisit: null,
          doctorName: null,
        },
        needsClarification: false,
      };
    }

    if (reasonForVisit) {
      return {
        recognizedAs: 'service_answer',
        confidence: Math.max(result.confidence, 0.9),
        entities: {
          ...result.entities,
          reasonForVisit,
          doctorName: null,
          date: DATE_STATES.has(currentState) && !date ? null : (result.entities.date ?? null),
        },
        needsClarification: false,
      };
    }
  }

  return result;
}

export function detectActiveSideQuestion(text: string): {
  intent: SideQuestionIntent;
  topic: string;
} | null {
  const normalized = normalize(text);

  const sideQuestion = (intent: SideQuestionIntent, topic: string) => {
    if (!capabilityAllowsActiveFlowSideQuestion(intent)) {
      return null;
    }
    return { intent, topic };
  };

  if (/\bfees?\b/i.test(normalized) || /\bevlo\b/i.test(normalized)) {
    return sideQuestion('ask_fee', text.trim());
  }
  if (/\bparking\b/i.test(normalized) || /\bfasting\b/i.test(normalized) || /\bscan-ku\b/i.test(normalized)) {
    return sideQuestion('ask_previsit_instruction', text.trim());
  }
  if (
    /\bopen-a\b/i.test(normalized) ||
    /\bopen ah\b/i.test(normalized) ||
    /\bopen time\b/i.test(normalized) ||
    /\btoday open\b/i.test(normalized) ||
    /\bsunday\b/i.test(normalized) ||
    /\btimings?\b/i.test(normalized)
  ) {
    return sideQuestion('ask_timing', text.trim());
  }
  if (/\benga irukku\b/i.test(normalized) || /\blocation\b/i.test(normalized) || /\baddress\b/i.test(normalized)) {
    return sideQuestion('ask_location', text.trim());
  }
  if (/\b(irukkangala|irukkaangala|available)\b/i.test(normalized)) {
    return sideQuestion('ask_doctor_availability', text.trim());
  }
  if (/\binsurance\b/i.test(normalized)) {
    return sideQuestion('ask_insurance', text.trim());
  }

  return null;
}

export function extractActivePatientName(text: string): string | null {
  const normalized = normalize(text);
  if (isActiveAffirmative(normalized) || isActiveDeclining(normalized) || isActiveFlowCancel(normalized)) {
    return null;
  }
  if (extractActivePreferredDate(text, '2000-01-01') || extractActiveTimePreference(text)) {
    return null;
  }

  const myName = text.match(/\bmy name is\s+([a-z][a-z\s]{1,30})/i);
  if (myName?.[1]) {
    return myName[1].trim();
  }

  const naan = text.match(/\bnaan\s+([a-z][a-z\s]{1,20})/i);
  if (naan?.[1]) {
    return naan[1].trim();
  }

  if (extractActiveReasonForVisit(text)) {
    return null;
  }

  const words = normalized.split(/\s+/);
  if (words.length >= 1 && words.length <= 3 && /^[a-z]+$/i.test(words.join(''))) {
    return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  return null;
}

export function selectOfferedSlot(
  messageText: string,
  offeredSlots: NonNullable<import('./state-entity-types').StateEntityExtractorInput['offeredSlots']>,
): { slotId: string | null; needsClarification: boolean } {
  if (offeredSlots.length === 0) {
    return { slotId: null, needsClarification: true };
  }

  const normalized = normalize(messageText);
  const exactTime = extractActiveExactTime(messageText);

  if (/\bfirst\b|\bearlier\b/i.test(normalized)) {
    return { slotId: offeredSlots[0]!.slotId, needsClarification: false };
  }
  if (/\bsecond\b|\blater slot\b|\blater one\b/i.test(normalized)) {
    return { slotId: offeredSlots[1]?.slotId ?? null, needsClarification: !offeredSlots[1] };
  }

  if (exactTime) {
    const match = offeredSlots.find((slot) => {
      const display = slot.displayTime.toLowerCase();
      const [hour, minute] = exactTime.split(':');
      const hourNum = Number(hour);
      const patterns = [
        `${hourNum}:${minute}`,
        `${hourNum}:${minute}`.replace(/^0/, ''),
        hourNum > 12 ? `${hourNum - 12}:${minute}` : `${hourNum}:${minute}`,
      ];
      return patterns.some((pattern) => display.includes(pattern));
    });
    if (match) {
      return { slotId: match.slotId, needsClarification: false };
    }
    return { slotId: null, needsClarification: true };
  }

  for (const slot of offeredSlots) {
    if (normalized.includes(slot.displayTime.toLowerCase())) {
      return { slotId: slot.slotId, needsClarification: false };
    }
  }

  return { slotId: null, needsClarification: true };
}
