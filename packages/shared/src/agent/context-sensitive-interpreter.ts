import type { LanguagePack } from './language-pack';
import { matchesLanguagePackWord, normalizeLanguagePackText } from './language-pack';
import type { StateEntityExtractorInput, StateEntityExtractorResult } from './state-entity-types';

function result(
  recognizedAs: StateEntityExtractorResult['recognizedAs'],
  confidence = 0.95,
): StateEntityExtractorResult {
  return {
    recognizedAs,
    confidence,
    entities: {},
    needsClarification: false,
  };
}

function isNegativeOrCancelPhrase(normalized: string, pack: LanguagePack): boolean {
  return (
    matchesLanguagePackWord(normalized, pack.noWords) ||
    matchesLanguagePackWord(normalized, pack.cancelWords) ||
    matchesLanguagePackWord(normalized, pack.laterWords)
  );
}

export function resolveContextSensitiveAnswer(
  input: StateEntityExtractorInput,
  pack: LanguagePack,
): StateEntityExtractorResult | null {
  const normalized = normalizeLanguagePackText(input.messageText);
  const { currentFlow, currentState } = input;
  const negative = isNegativeOrCancelPhrase(normalized, pack);
  const laterOnly =
    matchesLanguagePackWord(normalized, pack.laterWords) &&
    !matchesLanguagePackWord(normalized, pack.noWords) &&
    !matchesLanguagePackWord(normalized, pack.cancelWords);

  if (
    currentFlow === 'booking' &&
    (currentState === 'CONFIRM_DETAILS' || currentState === 'CONFIRM_DOCTOR')
  ) {
    if (negative) {
      return result('flow_cancel');
    }
    if (matchesLanguagePackWord(normalized, pack.yesWords)) {
      return result('yes_confirmation');
    }
  }

  if (currentFlow === 'cancel' && currentState === 'CONFIRM_CANCEL_REQUEST') {
    if (matchesLanguagePackWord(normalized, pack.noWords)) {
      return result('no_rejection');
    }
    if (
      matchesLanguagePackWord(normalized, pack.yesWords) ||
      (/\b(cancel|yes|seri|pannunga)\b/i.test(normalized) &&
        !matchesLanguagePackWord(normalized, pack.noWords))
    ) {
      return result('yes_confirmation');
    }
  }

  if (currentFlow === 'reschedule' && currentState === 'CONFIRM_RESCHEDULE_REQUEST') {
    if (matchesLanguagePackWord(normalized, pack.noWords)) {
      return result('no_rejection');
    }
  }

  if (
    currentFlow === 'handoff' &&
    (currentState === 'ASK_REASON' || currentState === 'ASK_REASON_OPTIONAL')
  ) {
    if (negative || matchesLanguagePackWord(normalized, pack.noWords)) {
      return result('flow_cancel');
    }
  }

  if (currentFlow === 'booking' && currentState === 'ASK_PATIENT_NAME') {
    if (negative) {
      return result('flow_cancel');
    }
  }

  if (
    currentFlow === 'booking' &&
    (currentState === 'PROPOSE_SLOTS' || currentState === 'PROPOSE_NEW_SLOTS') &&
    (laterOnly || matchesLanguagePackWord(normalized, pack.laterWords))
  ) {
    if (/\b(later slot|later one|first one|first)\b/i.test(normalized)) {
      return null;
    }
    if (!/\bsecond\b/i.test(normalized)) {
      return result('flow_cancel');
    }
  }

  return null;
}
