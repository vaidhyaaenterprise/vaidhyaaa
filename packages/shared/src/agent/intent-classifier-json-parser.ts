import type { IntentClassifierResult } from '../adapters/index';
import { AGENT_INTENTS, DEFAULT_INTENT_CONFIDENCE, LOW_INTENT_CONFIDENCE } from './intents';
import { LlmJsonParser } from './llm-json-parser';

const VALID_INTENTS = new Set<string>(AGENT_INTENTS);

const DEFAULT_ENTITIES = {
  patientName: null,
  doctorName: null,
  reasonForVisit: null,
  date: null,
  timePreference: null,
  visitType: null,
  dayName: null,
  feeCategory: null,
  topic: null,
  requestedLanguageCode: null,
} as const;

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeIntent(intent: unknown): string {
  if (typeof intent !== 'string') {
    return 'unknown';
  }
  const normalized = intent.trim();
  if (normalized === 'greeting') {
    return 'greeting_smalltalk';
  }
  if (VALID_INTENTS.has(normalized)) {
    return normalized;
  }
  return 'unknown';
}

export function normalizeIntentClassifierResult(
  value: Record<string, unknown>,
  languageCode: string,
): IntentClassifierResult {
  const entitiesRaw = (value.entities ?? {}) as Record<string, unknown>;
  const safetyRaw = (value.safety ?? {}) as Record<string, unknown>;
  const intent = normalizeIntent(value.intent);
  const confidence = readNumber(value.confidence, intent === 'unknown' ? LOW_INTENT_CONFIDENCE : DEFAULT_INTENT_CONFIDENCE);

  return {
    intent,
    confidence,
    languageCode: readNullableString(value.languageCode) ?? languageCode,
    entities: {
      patientName: readNullableString(entitiesRaw.patientName),
      doctorName: readNullableString(entitiesRaw.doctorName),
      reasonForVisit: readNullableString(entitiesRaw.reasonForVisit),
      date: readNullableString(entitiesRaw.date),
      timePreference: readNullableString(entitiesRaw.timePreference),
      visitType: readNullableString(entitiesRaw.visitType),
      dayName: readNullableString(entitiesRaw.dayName),
      feeCategory:
        entitiesRaw.feeCategory === 'consultation' ||
        entitiesRaw.feeCategory === 'followup' ||
        entitiesRaw.feeCategory === 'procedure'
          ? entitiesRaw.feeCategory
          : null,
      topic: readNullableString(entitiesRaw.topic),
      requestedLanguageCode: readNullableString(entitiesRaw.requestedLanguageCode),
    },
    safety: {
      isEmergency: readBoolean(safetyRaw.isEmergency, intent === 'emergency'),
      isMedicalAdviceRequest: readBoolean(
        safetyRaw.isMedicalAdviceRequest,
        intent === 'medical_advice_request',
      ),
      reason: readNullableString(safetyRaw.reason),
    },
    needsClarification: readBoolean(
      value.needsClarification,
      intent === 'unknown' || confidence <= LOW_INTENT_CONFIDENCE,
    ),
  };
}

export function parseIntentClassifierJson(
  content: string | null | undefined,
  languageCode: string,
  parser = new LlmJsonParser(),
): IntentClassifierResult | null {
  if (!content || content.trim().length === 0) {
    return null;
  }

  const parsed = parser.parseObject<Record<string, unknown>>(content);
  if (!parsed.ok) {
    return null;
  }

  return normalizeIntentClassifierResult(parsed.value, languageCode);
}

export function unknownIntentClassifierResult(languageCode: string): IntentClassifierResult {
  return {
    intent: 'unknown',
    confidence: LOW_INTENT_CONFIDENCE,
    languageCode,
    entities: { ...DEFAULT_ENTITIES },
    safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: 'invalid_llm_json' },
    needsClarification: true,
  };
}
