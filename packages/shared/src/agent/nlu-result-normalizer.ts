import type { IntentClassifierResult } from '../adapters/index';

import { parseActivePrompt } from './conversation-policy';

export const ACTIVE_FLOW_CLASSIFIER_INTERRUPTS = new Set([
  'emergency',
  'medical_advice_request',
  'ask_human_agent',
  'cancel_appointment',
  'reschedule_appointment',
  'language_switch',
]);

const REASON_FOR_VISIT_OVERRIDE_INTENTS = new Set([
  'greeting_smalltalk',
  'greeting',
  'unknown',
  'out_of_scope',
]);

const STRUCTURED_NON_BOOKING_INTENTS = new Set([
  'ask_fee',
  'ask_timing',
  'ask_location',
  'ask_doctor_availability',
  'ask_previsit_instruction',
  'ask_insurance',
  'unsupported_service',
]);

export type NluNormalizationResult = {
  classification: IntentClassifierResult;
  rawIntent: string;
  normalizedIntent: string;
  normalizationReason: string | null;
};

export function hasActiveBookingPrompt(collected?: Record<string, unknown>): boolean {
  const prompt = parseActivePrompt(collected ?? {});
  if (!prompt) {
    return false;
  }
  return (prompt.flow ?? 'booking') === 'booking';
}

export function isActiveFlowClassifierInterrupt(intent: string): boolean {
  return ACTIVE_FLOW_CLASSIFIER_INTERRUPTS.has(intent);
}

export function normalizeIntentClassification(
  classification: IntentClassifierResult,
  context: {
    collected?: Record<string, unknown>;
    currentFlow?: string;
    currentState?: string;
  } = {},
): NluNormalizationResult {
  const rawIntent = classification.intent;
  let normalizedIntent = rawIntent;
  let normalizationReason: string | null = null;

  const reasonForVisit = classification.entities.reasonForVisit?.trim();
  const safe =
    !classification.safety.isEmergency && !classification.safety.isMedicalAdviceRequest;

  if (reasonForVisit && safe) {
    if (REASON_FOR_VISIT_OVERRIDE_INTENTS.has(normalizedIntent)) {
      normalizedIntent = 'book_appointment';
      normalizationReason = 'reason_for_visit_entity';
    } else if (
      normalizedIntent !== 'book_appointment' &&
      !isActiveFlowClassifierInterrupt(normalizedIntent) &&
      !STRUCTURED_NON_BOOKING_INTENTS.has(normalizedIntent)
    ) {
      normalizedIntent = 'book_appointment';
      normalizationReason = 'reason_for_visit_entity';
    }
  }

  const inActiveBookingPrompt =
    context.currentFlow === 'booking' ||
    hasActiveBookingPrompt(context.collected) ||
    (context.currentState !== undefined &&
      context.currentState !== 'IDLE' &&
      context.currentState !== 'DONE' &&
      context.currentFlow === 'booking');

  if (
    inActiveBookingPrompt &&
    !isActiveFlowClassifierInterrupt(normalizedIntent) &&
    normalizedIntent !== 'active_flow_answer' &&
    !classification.safety.isEmergency &&
    !classification.safety.isMedicalAdviceRequest
  ) {
    if (normalizedIntent !== 'active_flow_answer') {
      normalizedIntent = 'active_flow_answer';
      normalizationReason = normalizationReason ?? 'active_booking_prompt';
    }
  }

  if (normalizedIntent === rawIntent) {
    return {
      classification,
      rawIntent,
      normalizedIntent,
      normalizationReason,
    };
  }

  return {
    classification: {
      ...classification,
      intent: normalizedIntent,
    },
    rawIntent,
    normalizedIntent,
    normalizationReason,
  };
}
