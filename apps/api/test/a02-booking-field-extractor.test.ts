import { describe, expect, it } from 'vitest';

import {
  mapClassificationToBookingFields,
  resolveTimingScopeFromClassification,
  type IntentClassifierResult,
} from '@vaidya/shared';

import {
  applyExtractedToCollected,
  formatTimeOptions,
  getAvailableTimePreferencesForDate,
} from '../src/modules/booking/booking-field-extractor';

function classification(entities: IntentClassifierResult['entities']): IntentClassifierResult {
  return {
    intent: 'book_appointment',
    confidence: 0.9,
    languageCode: 'ta_tanglish',
    entities,
    safety: { isEmergency: false, isMedicalAdviceRequest: false },
    needsClarification: false,
  };
}

describe('A02 LLM entity mapping and booking slot helpers', () => {
  const timezone = 'Asia/Kolkata';

  it('maps classifier date and time preference to booking fields', () => {
    const fields = mapClassificationToBookingFields(
      classification({
        reasonForVisit: 'fever',
        date: '2026-06-21',
        timePreference: 'evening',
      }),
    );
    expect(fields.reason_for_visit).toBe('fever');
    expect(fields.preferred_date).toBe('2026-06-21');
    expect(fields.time_preference).toBe('evening');
  });

  it('resolves timing scope from classifier dayName', () => {
    const scope = resolveTimingScopeFromClassification(
      classification({ dayName: 'Sunday' }),
      timezone,
    );
    expect(scope).toEqual({ kind: 'day', dayOfWeek: 7, dayName: 'Sunday' });
  });

  it('clears stale time when only a new date is provided', () => {
    const extracted = mapClassificationToBookingFields(
      classification({ date: '2026-06-21' }),
    );
    const next = applyExtractedToCollected(
      {
        preferred_date: '2026-06-20',
        time_preference: 'afternoon',
      },
      extracted,
    );
    expect(next.preferred_date).toBe('2026-06-21');
    expect(next.time_preference).toBeUndefined();
  });

  it('updates date and time together during alternate recovery', () => {
    const extracted = mapClassificationToBookingFields(
      classification({ date: '2026-06-21', timePreference: 'evening' }),
    );
    const next = applyExtractedToCollected(
      {
        preferred_date: '2026-06-20',
        time_preference: 'afternoon',
        awaiting_alternate_slot: true,
      },
      extracted,
    );
    expect(next.preferred_date).toBe('2026-06-21');
    expect(next.time_preference).toBe('evening');
    expect(next.awaiting_alternate_slot).toBeUndefined();
  });

  it('detects only evening availability for evening-only schedules', () => {
    const slots = [
      { start_time: '2026-06-21 18:30:00', available_count: 1 },
      { start_time: '2026-06-21 19:00:00', available_count: 1 },
    ];
    expect(getAvailableTimePreferencesForDate(slots, '2026-06-21')).toEqual(['evening']);
    expect(formatTimeOptions(['evening'])).toBe('evening');
  });
});
