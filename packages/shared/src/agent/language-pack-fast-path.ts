import {
  extractActiveExactTime,
  extractActivePreferredDate,
  selectOfferedSlot,
  type TimePreference,
} from './active-state-parsers';
import { resolveContextSensitiveAnswer } from './context-sensitive-interpreter';
import type { LanguagePack } from './language-pack';
import { getDefaultLanguagePack, matchesLanguagePackWord, normalizeLanguagePackText } from './language-pack';
import type { StateEntityExtractorInput, StateEntityExtractorResult } from './state-entity-types';

const DATE_STATES = new Set(['ASK_DATE', 'ASK_NEW_DATE', 'ASK_ALTERNATE_TIME']);
const TIME_STATES = new Set(['ASK_TIME', 'ASK_NEW_TIME']);
const CONFIRM_STATES = new Set(['CONFIRM_DETAILS', 'CONFIRM_DOCTOR', 'CONFIRM_CANCEL_REQUEST', 'CONFIRM_RESCHEDULE_REQUEST']);
const SLOT_STATES = new Set(['PROPOSE_SLOTS', 'PROPOSE_NEW_SLOTS']);

function addDaysIso(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function extractTimePreferenceFromPack(
  normalized: string,
  pack: LanguagePack,
): TimePreference | null {
  if (matchesLanguagePackWord(normalized, pack.timePreferenceWords.evening)) {
    return 'evening';
  }
  if (matchesLanguagePackWord(normalized, pack.timePreferenceWords.morning)) {
    return 'morning';
  }
  if (matchesLanguagePackWord(normalized, pack.timePreferenceWords.afternoon)) {
    return 'afternoon';
  }
  return null;
}

function resolveExactTimeForContext(
  text: string,
  timePreference: TimePreference | null,
): string | null {
  const exact = extractActiveExactTime(text);
  if (!exact) {
    return null;
  }
  const [hourText, minuteText] = exact.split(':');
  const hour = Number(hourText);
  const minute = minuteText ?? '00';
  if (Number.isNaN(hour)) {
    return exact;
  }
  if (timePreference === 'evening' && hour >= 1 && hour <= 12) {
    return `${hour + 12}:${minute}`;
  }
  if (/\b(maalai|evening|eve)\b/i.test(text) && hour >= 1 && hour <= 12) {
    return `${hour + 12}:${minute}`;
  }
  return exact;
}

export function interpretLanguagePackFastPath(
  input: StateEntityExtractorInput,
  pack: LanguagePack = getDefaultLanguagePack(input.languageCode),
): StateEntityExtractorResult | null {
  const text = input.messageText.trim();
  if (!text) {
    return null;
  }

  const normalized = normalizeLanguagePackText(text);
  const { currentState, referenceDate } = input;

  if (DATE_STATES.has(currentState)) {
    if (matchesLanguagePackWord(normalized, pack.todayWords)) {
      return {
        recognizedAs: 'date_answer',
        confidence: 0.95,
        entities: { date: referenceDate },
        needsClarification: false,
      };
    }
    if (matchesLanguagePackWord(normalized, pack.tomorrowWords)) {
      return {
        recognizedAs: 'date_answer',
        confidence: 0.95,
        entities: { date: addDaysIso(referenceDate, 1) },
        needsClarification: false,
      };
    }
    const parsedDate = extractActivePreferredDate(text, referenceDate);
    if (parsedDate) {
      return {
        recognizedAs: 'date_answer',
        confidence: 0.92,
        entities: { date: parsedDate },
        needsClarification: false,
      };
    }
  }

  if (TIME_STATES.has(currentState)) {
    const timePreference = extractTimePreferenceFromPack(normalized, pack);
    const exactTime = resolveExactTimeForContext(text, timePreference);
    if (timePreference || exactTime) {
      return {
        recognizedAs: 'time_answer',
        confidence: 0.95,
        entities: {
          timePreference: timePreference ?? null,
          exactTime: exactTime ?? null,
        },
        needsClarification: false,
      };
    }
  }

  if (CONFIRM_STATES.has(currentState)) {
    if (matchesLanguagePackWord(normalized, pack.yesWords)) {
      return {
        recognizedAs: 'yes_confirmation',
        confidence: 0.95,
        entities: {},
        needsClarification: false,
      };
    }
  }

  if (SLOT_STATES.has(currentState) && input.offeredSlots?.length) {
    const selection = selectOfferedSlot(text, input.offeredSlots);
    if (selection.slotId) {
      return {
        recognizedAs: 'slot_selection',
        confidence: 0.95,
        entities: { selectedSlotId: selection.slotId },
        needsClarification: false,
      };
    }
    if (selection.needsClarification) {
      return {
        recognizedAs: 'unknown',
        confidence: 0.4,
        entities: { selectedSlotId: null },
        needsClarification: true,
        clarificationReason: 'requested_time_not_in_offered_slots',
      };
    }
  }

  return null;
}

export function runActiveStatePreflight(
  input: StateEntityExtractorInput,
  pack: LanguagePack = getDefaultLanguagePack(input.languageCode),
): StateEntityExtractorResult | null {
  const contextual = resolveContextSensitiveAnswer(input, pack);
  if (contextual) {
    return contextual;
  }

  const fastPath = interpretLanguagePackFastPath(input, pack);
  if (fastPath && fastPath.confidence >= 0.9) {
    return fastPath;
  }

  return null;
}
