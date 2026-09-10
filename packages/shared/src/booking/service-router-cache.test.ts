import { describe, expect, it, beforeEach } from 'vitest';

import {
  applyReasonForVisitUpdate,
  buildServiceRouterMemoryCacheKey,
  clearServiceRouterMemoryCacheForTests,
  lookupServiceRouterCache,
  lookupServiceRouterMemoryCache,
  normalizeReasonForRouterCache,
  shouldPersistServiceRouterCache,
  storeServiceRouterCacheEntry,
  storeServiceRouterMemoryCache,
} from './service-router-cache';

const SERVICE_ID = '00000000-0000-4000-8000-000000000101';

describe('service-router-cache', () => {
  beforeEach(() => {
    clearServiceRouterMemoryCacheForTests();
  });

  it('normalizes reason keys case-insensitively', () => {
    expect(normalizeReasonForRouterCache('  Fever   ku ')).toBe('fever ku');
  });

  it('stores and reads session cache entries', () => {
    const collected = storeServiceRouterCacheEntry({}, 'Fever ku', {
      matched: true,
      clinicServiceId: SERVICE_ID,
      serviceKey: 'general',
      confidence: 0.9,
    });

    expect(lookupServiceRouterCache(collected, 'fever ku')).toEqual({
      matched: true,
      clinicServiceId: SERVICE_ID,
      serviceKey: 'general',
      confidence: 0.9,
    });
  });

  it('restores clinic service when reason changes back to a cached value', () => {
    const withFever = storeServiceRouterCacheEntry({}, 'Fever ku', {
      matched: true,
      clinicServiceId: SERVICE_ID,
      serviceKey: 'general',
      confidence: 0.9,
    });

    const switched = applyReasonForVisitUpdate(
      {
        ...withFever,
        reason_for_visit: 'Fever ku',
        clinic_service_id: SERVICE_ID,
        routing_source: 'service_router',
      },
      'Knee pain',
    );
    expect(switched.clinic_service_id).toBeUndefined();

    const restored = applyReasonForVisitUpdate(switched, 'Fever ku');
    expect(restored.clinic_service_id).toBe(SERVICE_ID);
    expect(restored.routing_source).toBe('service_router_cache');
  });

  it('does not persist transient router failures', () => {
    expect(
      shouldPersistServiceRouterCache({
        matched: false,
        confidence: 0.2,
        unsupportedReason: 'invalid_llm_json',
      }),
    ).toBe(false);
  });

  it('uses memory cache across sessions for the same clinic and reason', () => {
    const key = buildServiceRouterMemoryCacheKey(
      '00000000-0000-4000-8000-000000000010',
      'Knee pain',
      [SERVICE_ID],
    );
    const result = {
      matched: true,
      clinicServiceId: SERVICE_ID,
      serviceKey: 'ortho',
      confidence: 0.88,
    };

    storeServiceRouterMemoryCache(key, result, 60_000);
    expect(lookupServiceRouterMemoryCache(key)).toEqual(result);
  });
});
