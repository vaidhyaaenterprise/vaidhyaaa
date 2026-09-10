import type { IntentClassifierResult } from '../adapters/index';
import type { MessageSafetyResult } from './state-entity-types';

function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function detectMessageSafety(messageText: string): MessageSafetyResult {
  const text = messageText.toLowerCase().replace(/\s+/g, ' ').trim();

  if (
    containsAny(text, [
      /\bchest pain\b/i,
      /\bmoochu vida kashtama\b/i,
      /\baccident\b/i,
      /\bbreath(ing)? (trouble|problem|kashtama|difficulty)\b/i,
      /\bchild not breathing\b/i,
      /\bsevere bleeding\b/i,
      /\bunconscious\b/i,
      /\bfits?\b/i,
      /\bseizure\b/i,
      /\bstroke\b/i,
      /\b108\b/i,
      /\bemergency\b/i,
    ])
  ) {
    return {
      isEmergency: true,
      isMedicalAdviceRequest: false,
      reason: 'emergency_symptoms_detected',
    };
  }

  if (
    containsAny(text, [
      /\benn[aae]? tablet\b/i,
      /\benn[aae]? medicine\b/i,
      /\bmedicine (kudukka|edukka|sollunga)\b/i,
      /\bmedical advice\b/i,
      /\bwhat tablet\b/i,
      /\bwhich medicine\b/i,
      /\bfever-ku enna tablet\b/i,
      /\bfever-ku enna medicine\b/i,
      /\bdosage\b/i,
      /\bantibiotic\b/i,
      /\bpainkiller\b/i,
      /\bparacetamol\b/i,
      /\bshould i take\b/i,
      /\btake .+ for fever\b/i,
    ])
  ) {
    return {
      isEmergency: false,
      isMedicalAdviceRequest: true,
      reason: 'medication_advice_request',
    };
  }

  return {
    isEmergency: false,
    isMedicalAdviceRequest: false,
    reason: null,
  };
}

export function buildSafetyIntentClassification(
  languageCode: string,
  safety: MessageSafetyResult,
): IntentClassifierResult {
  return {
    intent: safety.isEmergency ? 'emergency' : 'medical_advice_request',
    confidence: 1,
    languageCode,
    entities: {},
    safety: {
      isEmergency: safety.isEmergency,
      isMedicalAdviceRequest: safety.isMedicalAdviceRequest,
      reason: safety.reason ?? null,
    },
    needsClarification: false,
  };
}
