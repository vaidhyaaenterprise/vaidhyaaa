import type { ServiceRouterResult } from '../adapters/index';

import type { BookingCollected } from './collected';

export type ServiceRouterCacheEntry = ServiceRouterResult;

export type ServiceRouterCache = Record<string, ServiceRouterCacheEntry>;

export type ServiceRouterRouteOutcome = {
  result: ServiceRouterResult;
  fromCache: boolean;
  cacheLayer?: 'session' | 'memory';
};

type MemoryCacheEntry = {
  result: ServiceRouterResult;
  expiresAt: number;
};

const memoryCache = new Map<string, MemoryCacheEntry>();

export function normalizeReasonForRouterCache(reason: string): string {
  return reason.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function readServiceRouterCache(collected: BookingCollected): ServiceRouterCache {
  return (collected.service_router_cache ?? {}) as ServiceRouterCache;
}

function toServiceRouterResult(entry: ServiceRouterCacheEntry): ServiceRouterResult {
  return {
    matched: entry.matched,
    confidence: entry.confidence,
    ...(entry.clinicServiceId ? { clinicServiceId: entry.clinicServiceId } : {}),
    ...(entry.serviceKey ? { serviceKey: entry.serviceKey } : {}),
    ...(entry.unsupportedReason ? { unsupportedReason: entry.unsupportedReason } : {}),
    ...(entry.needsClarification !== undefined
      ? { needsClarification: entry.needsClarification }
      : {}),
    ...(entry.clarificationQuestion ? { clarificationQuestion: entry.clarificationQuestion } : {}),
  };
}

export function lookupServiceRouterCache(
  collected: BookingCollected,
  reasonForVisit: string,
): ServiceRouterResult | null {
  const key = normalizeReasonForRouterCache(reasonForVisit);
  if (!key) {
    return null;
  }

  const entry = readServiceRouterCache(collected)[key];
  if (!entry) {
    return null;
  }

  return toServiceRouterResult(entry);
}

export function shouldPersistServiceRouterCache(result: ServiceRouterResult): boolean {
  if (result.matched) {
    return true;
  }
  return result.unsupportedReason === 'no_matching_clinic_service';
}

export function storeServiceRouterCacheEntry(
  collected: BookingCollected,
  reasonForVisit: string,
  result: ServiceRouterResult,
): BookingCollected {
  const key = normalizeReasonForRouterCache(reasonForVisit);
  if (!key || !shouldPersistServiceRouterCache(result)) {
    return collected;
  }

  return {
    ...collected,
    service_router_cache: {
      ...readServiceRouterCache(collected),
      [key]: { ...result },
    },
  };
}

export function applyReasonForVisitUpdate(
  collected: BookingCollected,
  nextReason: string,
): BookingCollected {
  const trimmed = nextReason.trim();
  if (!trimmed) {
    return collected;
  }

  const prevKey = collected.reason_for_visit
    ? normalizeReasonForRouterCache(collected.reason_for_visit)
    : '';
  const nextKey = normalizeReasonForRouterCache(trimmed);

  if (prevKey === nextKey) {
    return { ...collected, reason_for_visit: trimmed };
  }

  const next: BookingCollected = {
    ...collected,
    reason_for_visit: trimmed,
  };
  delete next.clinic_service_id;
  delete next.routing_source;

  const cached = lookupServiceRouterCache(next, trimmed);
  if (cached?.matched && cached.clinicServiceId) {
    next.clinic_service_id = cached.clinicServiceId;
    next.routing_source = 'service_router_cache';
  }

  return next;
}

export function buildServiceRouterMemoryCacheKey(
  clinicId: string,
  reasonForVisit: string,
  serviceIds: string[],
): string {
  return `${clinicId}|${normalizeReasonForRouterCache(reasonForVisit)}|${[...serviceIds].sort().join(',')}`;
}

export function lookupServiceRouterMemoryCache(key: string): ServiceRouterResult | null {
  const entry = memoryCache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }

  return toServiceRouterResult(entry.result);
}

export function storeServiceRouterMemoryCache(
  key: string,
  result: ServiceRouterResult,
  ttlMs: number,
): void {
  if (ttlMs <= 0 || !shouldPersistServiceRouterCache(result)) {
    return;
  }

  memoryCache.set(key, {
    result: { ...result },
    expiresAt: Date.now() + ttlMs,
  });
}

export function clearServiceRouterMemoryCacheForTests(): void {
  memoryCache.clear();
}
