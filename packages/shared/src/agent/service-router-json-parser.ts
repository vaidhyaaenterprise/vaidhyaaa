import type { ActiveClinicServiceProfile, ServiceRouterResult } from '../adapters/index';

import { LOW_INTENT_CONFIDENCE } from './intents';
import { routeServiceFromProfiles } from './service-router-engine';

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function normalizeServiceRouterResult(
  raw: ServiceRouterResult,
  activeClinicServices: ActiveClinicServiceProfile[],
): ServiceRouterResult {
  const allowedIds = new Set(activeClinicServices.map((service) => service.id));
  const allowedKeys = new Set(activeClinicServices.map((service) => service.serviceKey));

  if (raw.unsupportedReason === 'red_flag_emergency') {
    return {
      matched: false,
      confidence: raw.confidence,
      unsupportedReason: 'red_flag_emergency',
      needsClarification: false,
    };
  }

  if (raw.needsClarification) {
    return {
      matched: false,
      confidence: raw.confidence,
      needsClarification: true,
      ...(raw.clarificationQuestion ? { clarificationQuestion: raw.clarificationQuestion } : {}),
      ...(raw.unsupportedReason ? { unsupportedReason: raw.unsupportedReason } : {}),
    };
  }

  if (!raw.matched) {
    return {
      matched: false,
      confidence: raw.confidence,
      ...(raw.unsupportedReason ? { unsupportedReason: raw.unsupportedReason } : {}),
      needsClarification: raw.needsClarification ?? false,
      ...(raw.clarificationQuestion ? { clarificationQuestion: raw.clarificationQuestion } : {}),
    };
  }

  const clinicServiceId = raw.clinicServiceId;
  const serviceKey = raw.serviceKey;
  const serviceById = clinicServiceId ? activeClinicServices.find((service) => service.id === clinicServiceId) : null;
  const serviceByKey =
    !serviceById && serviceKey
      ? activeClinicServices.find((service) => service.serviceKey === serviceKey)
      : null;
  const resolved = serviceById ?? serviceByKey;

  if (!resolved || !allowedIds.has(resolved.id)) {
    return {
      matched: false,
      confidence: LOW_INTENT_CONFIDENCE,
      unsupportedReason: 'invalid_clinic_service_selection',
      needsClarification: false,
    };
  }

  if (serviceKey && !allowedKeys.has(serviceKey)) {
    return {
      matched: false,
      confidence: LOW_INTENT_CONFIDENCE,
      unsupportedReason: 'invalid_clinic_service_selection',
      needsClarification: false,
    };
  }

  return {
    matched: true,
    clinicServiceId: resolved.id,
    serviceKey: resolved.serviceKey,
    confidence: raw.confidence,
    needsClarification: false,
  };
}

export function parseServiceRouterJson(
  value: unknown,
  input: {
    reasonForVisit: string;
    patientAgeHint?: string | null;
    activeClinicServices: ActiveClinicServiceProfile[];
  },
): ServiceRouterResult | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const clinicServiceId = readString(record.clinicServiceId);
  const serviceKey = readString(record.serviceKey);
  const unsupportedReason = readString(record.unsupportedReason);
  const clarificationQuestion = readString(record.clarificationQuestion);
  const parsed: ServiceRouterResult = {
    matched: readBoolean(record.matched, false),
    confidence: readNumber(record.confidence, LOW_INTENT_CONFIDENCE),
    ...(clinicServiceId ? { clinicServiceId } : {}),
    ...(serviceKey ? { serviceKey } : {}),
    ...(unsupportedReason ? { unsupportedReason } : {}),
    ...(record.needsClarification !== undefined
      ? { needsClarification: readBoolean(record.needsClarification, false) }
      : {}),
    ...(clarificationQuestion ? { clarificationQuestion } : {}),
  };

  const normalized = normalizeServiceRouterResult(parsed, input.activeClinicServices);
  if (
    normalized.matched ||
    normalized.unsupportedReason === 'red_flag_emergency' ||
    normalized.needsClarification
  ) {
    return normalized;
  }

  if (normalized.confidence < 0.55) {
    return routeServiceFromProfiles({
      clinicId: '',
      reasonForVisit: input.reasonForVisit,
      activeClinicServices: input.activeClinicServices,
      ...(input.patientAgeHint !== undefined ? { patientAgeHint: input.patientAgeHint } : {}),
    });
  }

  return normalized;
}
