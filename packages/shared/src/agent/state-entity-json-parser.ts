import { LlmJsonParser } from './llm-json-parser';
import {
  extractActiveExactTime,
  extractActivePreferredDate,
  extractActiveReasonForVisit,
  extractActiveTimePreference,
} from './active-state-parsers';
import type {
  SideQuestionIntent,
  StateEntityExtractorEntities,
  StateEntityExtractorResult,
  StateRecognizedAs,
} from './state-entity-types';

const VALID_RECOGNIZED: Set<string> = new Set([
  'date_answer',
  'time_answer',
  'doctor_answer',
  'service_answer',
  'slot_selection',
  'patient_name',
  'patient_identity_selection',
  'yes_confirmation',
  'no_rejection',
  'flow_cancel',
  'side_question',
  'scope_redirect',
  'handoff_reason',
  'unknown',
]);

const REASON_OR_DOCTOR_STATES = new Set([
  'BOOKING_STARTED',
  'ASK_PROBLEM_OR_DOCTOR',
  'ASK_REASON',
]);
const DATE_STATES = new Set(['ASK_DATE', 'ASK_NEW_DATE', 'ASK_ALTERNATE_TIME']);
const TIME_STATES = new Set(['ASK_TIME', 'ASK_NEW_TIME']);

const VALID_SIDE_QUESTION_INTENTS: Set<string> = new Set([
  'ask_fee',
  'ask_timing',
  'ask_location',
  'ask_doctor_availability',
  'ask_previsit_instruction',
  'ask_insurance',
  'ask_human_agent',
]);

export type StateEntityExtractorParseContext = {
  currentState: string;
  currentFlow: string;
  messageText: string;
  referenceDate: string;
};

function readStringField(
  value: Record<string, unknown>,
  entitiesRaw: Record<string, unknown>,
  key: string,
): string | null {
  const fromEntities = entitiesRaw[key];
  if (typeof fromEntities === 'string' && fromEntities.trim()) {
    return fromEntities.trim();
  }
  const topLevel = value[key];
  if (typeof topLevel === 'string' && topLevel.trim()) {
    return topLevel.trim();
  }
  return null;
}

function readSideQuestionIntent(
  value: Record<string, unknown>,
  entitiesRaw: Record<string, unknown>,
): SideQuestionIntent | null {
  const raw = entitiesRaw.sideQuestionIntent ?? value.sideQuestionIntent;
  if (typeof raw === 'string' && VALID_SIDE_QUESTION_INTENTS.has(raw)) {
    return raw as SideQuestionIntent;
  }
  return null;
}

function parseEntities(
  value: Record<string, unknown>,
  entitiesRaw: Record<string, unknown>,
): StateEntityExtractorEntities {
  return {
    date: readStringField(value, entitiesRaw, 'date'),
    timePreference:
      entitiesRaw.timePreference === 'morning' ||
      entitiesRaw.timePreference === 'afternoon' ||
      entitiesRaw.timePreference === 'evening'
        ? entitiesRaw.timePreference
        : null,
    exactTime: readStringField(value, entitiesRaw, 'exactTime'),
    selectedSlotId: readStringField(value, entitiesRaw, 'selectedSlotId'),
    doctorId: readStringField(value, entitiesRaw, 'doctorId'),
    doctorName: readStringField(value, entitiesRaw, 'doctorName'),
    clinicServiceId: readStringField(value, entitiesRaw, 'clinicServiceId'),
    reasonForVisit: readStringField(value, entitiesRaw, 'reasonForVisit'),
    patientName: readStringField(value, entitiesRaw, 'patientName'),
    patientIdentityLabel: readStringField(value, entitiesRaw, 'patientIdentityLabel'),
    sideQuestionIntent: readSideQuestionIntent(value, entitiesRaw),
    sideQuestionTopic: readStringField(value, entitiesRaw, 'sideQuestionTopic'),
    dayName: readStringField(value, entitiesRaw, 'dayName'),
  };
}

function normalizeEntityDate(
  dateValue: string | null | undefined,
  referenceDate: string,
): string | null {
  if (!dateValue) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return dateValue;
  }
  return extractActivePreferredDate(dateValue, referenceDate);
}

function resolveRecognizedAs(
  value: Record<string, unknown>,
  entities: StateEntityExtractorEntities,
  context?: StateEntityExtractorParseContext,
): StateRecognizedAs {
  const rawRecognized = typeof value.recognizedAs === 'string' ? value.recognizedAs : 'unknown';
  if (VALID_RECOGNIZED.has(rawRecognized) && rawRecognized !== 'unknown') {
    return rawRecognized as StateRecognizedAs;
  }

  if (entities.sideQuestionIntent) {
    return 'side_question';
  }

  if (context) {
    if (DATE_STATES.has(context.currentState) && entities.date) {
      return 'date_answer';
    }
    if (TIME_STATES.has(context.currentState) && (entities.timePreference || entities.exactTime)) {
      return 'time_answer';
    }
    if (REASON_OR_DOCTOR_STATES.has(context.currentState)) {
      if (entities.reasonForVisit) {
        return 'service_answer';
      }
      if (entities.doctorName) {
        return 'doctor_answer';
      }
    }
  }

  if (VALID_RECOGNIZED.has(rawRecognized)) {
    return rawRecognized as StateRecognizedAs;
  }

  return 'unknown';
}

function enrichFromMessage(
  entities: StateEntityExtractorEntities,
  recognizedAs: StateRecognizedAs,
  rawRecognized: string,
  context: StateEntityExtractorParseContext,
): { entities: StateEntityExtractorEntities; recognizedAs: StateRecognizedAs } {
  const next = { ...entities };

  if (DATE_STATES.has(context.currentState)) {
    const parsedDate =
      normalizeEntityDate(next.date, context.referenceDate) ??
      extractActivePreferredDate(context.messageText, context.referenceDate);
    const reasonFromMessage = extractActiveReasonForVisit(context.messageText);
    const reason = next.reasonForVisit ?? reasonFromMessage;

    if (parsedDate && !reason) {
      next.date = parsedDate;
      next.reasonForVisit = null;
      next.doctorName = null;
      return { entities: next, recognizedAs: 'date_answer' };
    }

    if (reason && !parsedDate) {
      next.reasonForVisit = reason;
      next.date = null;
      next.doctorName = null;
      return { entities: next, recognizedAs: 'service_answer' };
    }

    if (parsedDate && reason) {
      next.date = parsedDate;
      next.reasonForVisit = reason;
      next.doctorName = null;
      return { entities: next, recognizedAs: 'date_answer' };
    }

    if (rawRecognized !== 'service_answer') {
      next.reasonForVisit = null;
      next.doctorName = null;
    }
    return { entities: next, recognizedAs };
  }

  if (TIME_STATES.has(context.currentState)) {
    const timePreference =
      next.timePreference ?? extractActiveTimePreference(context.messageText);
    const exactTime = next.exactTime ?? extractActiveExactTime(context.messageText);
    if (timePreference || exactTime) {
      return {
        entities: {
          ...next,
          timePreference: timePreference ?? next.timePreference ?? null,
          exactTime: exactTime ?? next.exactTime ?? null,
        },
        recognizedAs: 'time_answer',
      };
    }
  }

  if (REASON_OR_DOCTOR_STATES.has(context.currentState)) {
    const parsedDate =
      normalizeEntityDate(next.date, context.referenceDate) ??
      extractActivePreferredDate(context.messageText, context.referenceDate);
    const reasonFromMessage = extractActiveReasonForVisit(context.messageText);
    const reason = next.reasonForVisit ?? reasonFromMessage;

    if (parsedDate && !reason && !next.doctorName) {
      next.date = parsedDate;
      next.reasonForVisit = null;
      next.doctorName = null;
      return { entities: next, recognizedAs: 'date_answer' };
    }

    if (rawRecognized !== 'date_answer') {
      next.date = null;
      next.timePreference = null;
      next.exactTime = null;
      next.dayName = null;
    }

    if (reason) {
      next.reasonForVisit = reason;
      return { entities: next, recognizedAs: 'service_answer' };
    }
    if (next.doctorName) {
      return { entities: next, recognizedAs: 'doctor_answer' };
    }
  }

  return { entities: next, recognizedAs };
}

function stripSpuriousEntities(
  entities: StateEntityExtractorEntities,
  recognizedAs: StateRecognizedAs,
  rawRecognized: string,
  context?: StateEntityExtractorParseContext,
): StateEntityExtractorEntities {
  if (!context) {
    return entities;
  }

  if (REASON_OR_DOCTOR_STATES.has(context.currentState) && rawRecognized !== 'date_answer') {
    return {
      ...entities,
      date: null,
      timePreference: null,
      exactTime: null,
      dayName: null,
    };
  }

  if (DATE_STATES.has(context.currentState) && rawRecognized !== 'service_answer') {
    return {
      ...entities,
      reasonForVisit: null,
      doctorName: null,
    };
  }

  return entities;
}

export function parseStateEntityExtractorJson(
  content: string | null | undefined,
  context?: StateEntityExtractorParseContext,
): StateEntityExtractorResult | null {
  const parser = new LlmJsonParser();
  const parsed = parser.parseObject<Record<string, unknown>>(content);
  if (!parsed.ok) {
    return null;
  }

  const value = parsed.value;
  const rawRecognized = typeof value.recognizedAs === 'string' ? value.recognizedAs : 'unknown';
  if (!VALID_RECOGNIZED.has(rawRecognized) && rawRecognized !== 'unknown') {
    return null;
  }

  const entitiesRaw = (value.entities ?? {}) as Record<string, unknown>;
  const confidence = Number(value.confidence ?? 0.5);
  let entities = parseEntities(value, entitiesRaw);
  if (context) {
    entities = {
      ...entities,
      date: normalizeEntityDate(entities.date, context.referenceDate),
    };
  }

  let recognizedAs = resolveRecognizedAs(value, entities, context);
  entities = stripSpuriousEntities(entities, recognizedAs, rawRecognized, context);

  if (context) {
    const enriched = enrichFromMessage(entities, recognizedAs, rawRecognized, context);
    entities = enriched.entities;
    recognizedAs = enriched.recognizedAs;
  }

  const resolvedConfidence =
    recognizedAs !== 'unknown' && rawRecognized === 'unknown'
      ? Math.max(Number.isFinite(confidence) ? confidence : 0.5, 0.85)
      : Number.isFinite(confidence)
        ? confidence
        : 0.5;

  return {
    recognizedAs,
    confidence: resolvedConfidence,
    entities,
    needsClarification:
      recognizedAs === 'unknown' ? true : Boolean(value.needsClarification),
    clarificationReason:
      typeof value.clarificationReason === 'string' ? value.clarificationReason : null,
  };
}

export function safeStateEntityFallback(reason?: string): StateEntityExtractorResult {
  return {
    recognizedAs: 'unknown',
    confidence: 0.3,
    entities: {},
    needsClarification: true,
    clarificationReason: reason ?? 'invalid_extractor_json',
  };
}

export function applyContextualStateEntityFallback(
  context: StateEntityExtractorParseContext,
): StateEntityExtractorResult {
  const emptyEntities: StateEntityExtractorEntities = {
    date: null,
    timePreference: null,
    exactTime: null,
    selectedSlotId: null,
    doctorId: null,
    doctorName: null,
    clinicServiceId: null,
    reasonForVisit: null,
    patientName: null,
    patientIdentityLabel: null,
    sideQuestionIntent: null,
    sideQuestionTopic: null,
    dayName: null,
  };
  const enriched = enrichFromMessage(emptyEntities, 'unknown', 'unknown', context);
  if (enriched.recognizedAs === 'unknown') {
    return safeStateEntityFallback('context_no_match');
  }

  return {
    recognizedAs: enriched.recognizedAs,
    confidence: 0.9,
    entities: enriched.entities,
    needsClarification: false,
    clarificationReason: null,
  };
}
