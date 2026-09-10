import type { ActiveClinicServiceProfile, ServiceRouterInput, ServiceRouterResult } from '../adapters/index';

import { detectMessageSafety } from './message-safety';
import { DEFAULT_INTENT_CONFIDENCE, LOW_INTENT_CONFIDENCE } from './intents';

const MIN_MATCH_SCORE = 0.55;
const CLARIFICATION_SCORE_GAP = 0.12;

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function extractProfileTerms(json: unknown): string[] {
  if (Array.isArray(json)) {
    return json.map((value) => normalizeText(String(value))).filter(Boolean);
  }

  if (typeof json === 'object' && json !== null) {
    const terms: string[] = [];
    for (const value of Object.values(json as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        terms.push(...value.map((entry) => normalizeText(String(entry))).filter(Boolean));
      } else if (typeof value === 'string') {
        const normalized = normalizeText(value);
        if (normalized) {
          terms.push(normalized);
        }
      }
    }
    return terms;
  }

  if (typeof json === 'string' && json.trim()) {
    return [normalizeText(json)];
  }

  return [];
}

export function extractRoutingExamples(json: unknown): string[] {
  const terms = extractProfileTerms(json);
  if (terms.length > 0) {
    return terms;
  }

  if (typeof json === 'object' && json !== null) {
    const examples = (json as { examples?: unknown }).examples;
    if (Array.isArray(examples)) {
      return examples.map((entry) => normalizeText(String(entry))).filter(Boolean);
    }
  }

  return [];
}

const ROUTING_STOPWORDS = new Set([
  'irukku',
  'irukka',
  'venum',
  'appointment',
  'doctor',
  'paakanum',
  'checkup',
  'consultation',
]);

function substantiveTermWords(term: string): string[] {
  return term
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0 && !ROUTING_STOPWORDS.has(word));
}

export function termMatchesReason(reason: string, term: string): boolean {
  const normalizedReason = normalizeText(reason);
  const normalizedTerm = normalizeText(term);
  if (!normalizedReason || !normalizedTerm) {
    return false;
  }

  if (normalizedReason.includes(normalizedTerm)) {
    return true;
  }

  const termWords = substantiveTermWords(normalizedTerm);
  if (termWords.length === 0) {
    return normalizedReason.includes(normalizedTerm);
  }

  if (termWords.length === 1) {
    return normalizedReason.includes(termWords[0]!);
  }

  return termWords.every((word) => normalizedReason.includes(word));
}

export function matchesAnyProfileTerm(reason: string, terms: string[]): boolean {
  return terms.some((term) => termMatchesReason(reason, term));
}

export function isChildPatientContext(reason: string, patientAgeHint?: string | null): boolean {
  if (patientAgeHint && /\b(child|baby|infant|paed|pediatric|minor|kuzhandh)\b/i.test(patientAgeHint)) {
    return true;
  }

  return /\b(child|baby|kuzhandh|kuzhandhaikku|kuzhan|infant|paediatric|pediatric)\b/i.test(reason);
}

function isServiceExcluded(
  reason: string,
  service: ActiveClinicServiceProfile,
  childContext: boolean,
): boolean {
  const doesNotHandle = extractProfileTerms(service.doesNotHandleJson);
  if (matchesAnyProfileTerm(reason, doesNotHandle)) {
    return true;
  }

  if (
    !childContext &&
    /\bfever\b/i.test(reason) &&
    doesNotHandle.some((term) => /\badult fever\b/i.test(term))
  ) {
    return true;
  }

  return false;
}

function scoreServiceMatch(
  reason: string,
  service: ActiveClinicServiceProfile,
  childContext: boolean,
): number {
  let score = 0;
  const handles = extractProfileTerms(service.handlesJson);

  for (const term of handles) {
    if (!termMatchesReason(reason, term)) {
      continue;
    }

    const specificity = Math.min(0.45 + term.split(/\s+/).length * 0.12, 0.92);
    score = Math.max(score, specificity);
  }

  for (const example of extractRoutingExamples(service.routingExamplesJson)) {
    if (termMatchesReason(reason, example) || termMatchesReason(example, reason)) {
      score = Math.max(score, 0.72);
    }
  }

  const serviceLabel = `${service.serviceKey} ${service.serviceName}`.toLowerCase();
  if (childContext && /paed|pediatric|child/.test(serviceLabel) && /\bfever\b/i.test(reason)) {
    score += 0.12;
  }

  if (
    !childContext &&
    /general|physician|general_consultation/.test(serviceLabel) &&
    /\bfever\b/i.test(reason)
  ) {
    score = Math.max(score, 0.68);
  }

  if (/\bknee\b|\bjoint\b|\bback pain\b|\bleg pain\b/i.test(reason)) {
    if (/ortho|knee|joint|bone/.test(serviceLabel)) {
      score = Math.max(score, 0.88);
    }
  }

  if (/\btooth\b|\bdental\b|\bgum\b/i.test(reason)) {
    if (/dental|tooth|oral/.test(serviceLabel)) {
      score = Math.max(score, 0.88);
    }
  }

  if (/\beye\b|\bvision\b|\bspectacle\b/i.test(reason)) {
    if (/eye|ophthal|vision/.test(serviceLabel)) {
      score = Math.max(score, 0.88);
    }
  }

  return Math.min(score, 1);
}

export function buildServiceClarificationQuestion(
  services: ActiveClinicServiceProfile[],
): string {
  const labels = services.map((service) => service.serviceName).filter(Boolean);
  if (labels.length === 0) {
    return 'Which type of consultation do you need?';
  }
  if (labels.length === 1) {
    return `Do you need ${labels[0]}?`;
  }
  return `Is this for ${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}?`;
}

export function routeServiceFromProfiles(input: ServiceRouterInput): ServiceRouterResult {
  const reason = normalizeText(input.reasonForVisit || '');

  if (!reason) {
    return {
      matched: false,
      confidence: LOW_INTENT_CONFIDENCE,
      unsupportedReason: 'missing_reason_for_visit',
      needsClarification: true,
    };
  }

  if (detectMessageSafety(input.reasonForVisit).isEmergency) {
    return {
      matched: false,
      confidence: 1,
      unsupportedReason: 'red_flag_emergency',
      needsClarification: false,
    };
  }

  for (const service of input.activeClinicServices) {
    const redFlags = extractProfileTerms(service.redFlagsJson);
    if (matchesAnyProfileTerm(reason, redFlags)) {
      return {
        matched: false,
        confidence: 1,
        unsupportedReason: 'red_flag_emergency',
        needsClarification: false,
      };
    }
  }

  const childContext = isChildPatientContext(reason, input.patientAgeHint);
  const scored: Array<{ service: ActiveClinicServiceProfile; score: number }> = [];

  for (const service of input.activeClinicServices) {
    if (isServiceExcluded(reason, service, childContext)) {
      continue;
    }

    const score = scoreServiceMatch(reason, service, childContext);
    if (score >= MIN_MATCH_SCORE) {
      scored.push({ service, score });
    }
  }

  scored.sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return {
      matched: false,
      confidence: LOW_INTENT_CONFIDENCE,
      unsupportedReason: 'no_matching_clinic_service',
      needsClarification: false,
    };
  }

  if (
    scored.length >= 2 &&
    scored[0]!.score - scored[1]!.score < CLARIFICATION_SCORE_GAP
  ) {
    const candidates = scored.slice(0, 2).map((entry) => entry.service);
    return {
      matched: false,
      confidence: scored[0]!.score,
      needsClarification: true,
      clarificationQuestion: buildServiceClarificationQuestion(candidates),
    };
  }

  const best = scored[0]!;
  return {
    matched: true,
    clinicServiceId: best.service.id,
    serviceKey: best.service.serviceKey,
    confidence: Math.max(best.score, DEFAULT_INTENT_CONFIDENCE * 0.8),
    needsClarification: false,
  };
}
