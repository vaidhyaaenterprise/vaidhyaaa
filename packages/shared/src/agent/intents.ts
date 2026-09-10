/** Stable intent labels returned by the classifier. */
export const AGENT_INTENTS = [
  'book_appointment',
  'cancel_appointment',
  'reschedule_appointment',
  'ask_fee',
  'ask_timing',
  'ask_location',
  'ask_doctor_availability',
  'ask_previsit_instruction',
  'ask_insurance',
  'ask_human_agent',
  'greeting',
  'greeting_smalltalk',
  'emergency',
  'medical_advice_request',
  'language_switch',
  'unsupported_service',
  'out_of_scope',
  'unknown',
] as const;

export type AgentIntent = (typeof AGENT_INTENTS)[number];

export const DEFAULT_INTENT_CONFIDENCE = 0.92;
export const LOW_INTENT_CONFIDENCE = 0.45;
export const LOW_STATE_ENTITY_CONFIDENCE = 0.5;
