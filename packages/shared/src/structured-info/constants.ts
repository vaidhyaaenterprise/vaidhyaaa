import {
  KNOWLEDGE_CAPABILITY_INTENTS,
  STRUCTURED_INFO_CAPABILITY_INTENTS,
} from '../agent/receptionist-capability-registry';

export const FEE_CLARIFICATION_FLOW = 'fee_clarification' as const;

/** Intents answered from structured clinic DB (fees, hours, location, availability). */
export const STRUCTURED_INFO_INTENTS = STRUCTURED_INFO_CAPABILITY_INTENTS;

/** Intents answered from approved knowledge base content. */
export const KNOWLEDGE_INTENTS = KNOWLEDGE_CAPABILITY_INTENTS;
