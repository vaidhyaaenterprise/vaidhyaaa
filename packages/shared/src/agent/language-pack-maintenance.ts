import type { LanguagePack } from './language-pack';
import { normalizeLanguagePackText } from './language-pack';

export type LanguagePackWordField =
  | 'yes_words'
  | 'no_words'
  | 'cancel_words'
  | 'today_words'
  | 'tomorrow_words'
  | 'later_words'
  | 'time_preference_morning'
  | 'time_preference_afternoon'
  | 'time_preference_evening';

export type LanguagePackAdditionProposal = {
  language_code: string;
  field: LanguagePackWordField;
  word: string;
  source_example_id: string;
  expected_recognized_as: string;
};

export type ReviewedExampleForProposal = {
  id: string;
  languageCode: string;
  messageTextRedacted: string;
  contextFlow: string;
  contextState: string;
  expectedRecognizedAs: string;
  expectedIntent: string | null;
  expectedEntitiesJson: unknown;
};

const MAX_TOKEN_WORDS = 2;
const MAX_TOKEN_LENGTH = 32;

export function isEligibleLanguagePackToken(text: string): boolean {
  const normalized = normalizeLanguagePackText(text);
  if (!normalized) {
    return false;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_TOKEN_WORDS) {
    return false;
  }
  if (normalized.length > MAX_TOKEN_LENGTH) {
    return false;
  }
  return true;
}

export function resolveLanguagePackFieldForRecognizedAs(input: {
  expectedRecognizedAs: string;
  expectedEntitiesJson: unknown;
}): LanguagePackWordField | null {
  switch (input.expectedRecognizedAs) {
    case 'yes_confirmation':
      return 'yes_words';
    case 'no_rejection':
    case 'flow_cancel':
      return 'no_words';
    case 'date_answer': {
      const entities =
        input.expectedEntitiesJson && typeof input.expectedEntitiesJson === 'object'
          ? (input.expectedEntitiesJson as Record<string, unknown>)
          : {};
      if (entities.dateKind === 'today') {
        return 'today_words';
      }
      if (entities.dateKind === 'tomorrow') {
        return 'tomorrow_words';
      }
      return null;
    }
    case 'time_answer': {
      const entities =
        input.expectedEntitiesJson && typeof input.expectedEntitiesJson === 'object'
          ? (input.expectedEntitiesJson as Record<string, unknown>)
          : {};
      const preference = entities.timePreference;
      if (preference === 'morning') {
        return 'time_preference_morning';
      }
      if (preference === 'afternoon') {
        return 'time_preference_afternoon';
      }
      if (preference === 'evening') {
        return 'time_preference_evening';
      }
      return null;
    }
    default:
      return null;
  }
}

export function proposeLanguagePackAdditionsFromReviewedExamples(
  examples: ReviewedExampleForProposal[],
): { proposals: LanguagePackAdditionProposal[]; rejected: Array<{ id: string; reason: string }> } {
  const proposals: LanguagePackAdditionProposal[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  const seen = new Set<string>();

  for (const example of examples) {
    const token = example.messageTextRedacted.trim();
    if (!isEligibleLanguagePackToken(token)) {
      rejected.push({ id: example.id, reason: 'ineligible_token' });
      continue;
    }

    const field = resolveLanguagePackFieldForRecognizedAs({
      expectedRecognizedAs: example.expectedRecognizedAs,
      expectedEntitiesJson: example.expectedEntitiesJson,
    });
    if (!field) {
      rejected.push({ id: example.id, reason: 'unsupported_recognized_as' });
      continue;
    }

    const dedupeKey = `${example.languageCode}:${field}:${normalizeLanguagePackText(token)}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    proposals.push({
      language_code: example.languageCode,
      field,
      word: normalizeLanguagePackText(token),
      source_example_id: example.id,
      expected_recognized_as: example.expectedRecognizedAs,
    });
  }

  return { proposals, rejected };
}

export function appendWordsToLanguagePackField(
  pack: LanguagePack,
  field: LanguagePackWordField,
  words: string[],
): LanguagePack {
  const normalizedWords = words.map((word) => normalizeLanguagePackText(word)).filter(Boolean);
  if (normalizedWords.length === 0) {
    return pack;
  }

  const mergeUnique = (existing: string[]) => {
    const seen = new Set(existing.map((word) => normalizeLanguagePackText(word)));
    const merged = [...existing];
    for (const word of normalizedWords) {
      if (!seen.has(word)) {
        merged.push(word);
        seen.add(word);
      }
    }
    return merged;
  };

  switch (field) {
    case 'yes_words':
      return { ...pack, yesWords: mergeUnique(pack.yesWords) };
    case 'no_words':
      return { ...pack, noWords: mergeUnique(pack.noWords) };
    case 'cancel_words':
      return { ...pack, cancelWords: mergeUnique(pack.cancelWords) };
    case 'today_words':
      return { ...pack, todayWords: mergeUnique(pack.todayWords) };
    case 'tomorrow_words':
      return { ...pack, tomorrowWords: mergeUnique(pack.tomorrowWords) };
    case 'later_words':
      return { ...pack, laterWords: mergeUnique(pack.laterWords) };
    case 'time_preference_morning':
      return {
        ...pack,
        timePreferenceWords: {
          ...pack.timePreferenceWords,
          morning: mergeUnique(pack.timePreferenceWords.morning),
        },
      };
    case 'time_preference_afternoon':
      return {
        ...pack,
        timePreferenceWords: {
          ...pack.timePreferenceWords,
          afternoon: mergeUnique(pack.timePreferenceWords.afternoon),
        },
      };
    case 'time_preference_evening':
      return {
        ...pack,
        timePreferenceWords: {
          ...pack.timePreferenceWords,
          evening: mergeUnique(pack.timePreferenceWords.evening),
        },
      };
    default:
      return pack;
  }
}

export function languagePackToDbJson(pack: LanguagePack) {
  return {
    yesWordsJson: pack.yesWords,
    noWordsJson: pack.noWords,
    cancelWordsJson: pack.cancelWords,
    todayWordsJson: pack.todayWords,
    tomorrowWordsJson: pack.tomorrowWords,
    laterWordsJson: pack.laterWords,
    timePreferenceWordsJson: pack.timePreferenceWords,
  };
}

export function buildReviewedExamplesExportCases(
  rows: Array<{
    id: string;
    languageCode: string;
    messageTextRedacted: string;
    contextFlow: string;
    contextState: string;
    expectedRecognizedAs: string;
    expectedIntent: string | null;
    expectedEntitiesJson: unknown;
    source: string;
    approvedForPromptExamples: boolean;
    createdAt: Date;
  }>,
) {
  return rows.map((row) => ({
    id: row.id,
    language_code: row.languageCode,
    message_text_redacted: row.messageTextRedacted,
    context_flow: row.contextFlow,
    context_state: row.contextState,
    expected_recognized_as: row.expectedRecognizedAs,
    expected_intent: row.expectedIntent,
    expected_entities_json:
      row.expectedEntitiesJson && typeof row.expectedEntitiesJson === 'object'
        ? (row.expectedEntitiesJson as Record<string, unknown>)
        : {},
    source: row.source,
    approved_for_prompt_examples: row.approvedForPromptExamples,
    created_at: row.createdAt.toISOString(),
  }));
}
