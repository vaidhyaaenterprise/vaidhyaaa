import type { MessageTemplateKey } from '../templates/index';

import {
  RECEPTIONIST_CAPABILITY_REGISTRY,
  capabilityTemplateKeyForIntent,
  normalizeIntentToCapabilityKey,
} from './receptionist-capability-registry';

/** Maps classifier intents to default reply template keys (derived from capability registry). */
export const INTENT_TEMPLATE_MAP: Record<string, MessageTemplateKey> = Object.fromEntries(
  Object.entries(RECEPTIONIST_CAPABILITY_REGISTRY).map(([key, capability]) => [key, capability.templateKey]),
) as Record<string, MessageTemplateKey>;

INTENT_TEMPLATE_MAP.greeting = RECEPTIONIST_CAPABILITY_REGISTRY.greeting_smalltalk.templateKey;

export function templateKeyForIntent(intent: string): MessageTemplateKey {
  if (intent in INTENT_TEMPLATE_MAP) {
    return capabilityTemplateKeyForIntent(intent);
  }
  return RECEPTIONIST_CAPABILITY_REGISTRY[normalizeIntentToCapabilityKey(intent)].templateKey;
}
