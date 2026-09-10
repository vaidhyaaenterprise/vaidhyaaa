import { describe, expect, it } from 'vitest';

import { attachActivePrompt, buildActivePromptSnapshot } from './conversation-policy';
import { normalizeIntentClassification } from './nlu-result-normalizer';

const baseClassification = {
  intent: 'greeting_smalltalk',
  confidence: 0.9,
  languageCode: 'ta_tanglish' as const,
  entities: {
    patientName: null,
    doctorName: null,
    reasonForVisit: 'Fever',
    date: null,
    timePreference: null,
    visitType: null,
    dayName: null,
    feeCategory: null,
    topic: null,
    requestedLanguageCode: null,
  },
  safety: {
    isEmergency: false,
    isMedicalAdviceRequest: false,
    reason: null,
  },
  needsClarification: false,
};

describe('normalizeIntentClassification', () => {
  it('maps greeting_smalltalk with reasonForVisit to book_appointment', () => {
    const result = normalizeIntentClassification(baseClassification);
    expect(result.rawIntent).toBe('greeting_smalltalk');
    expect(result.normalizedIntent).toBe('book_appointment');
    expect(result.normalizationReason).toBe('reason_for_visit_entity');
  });

  it('does not override emergency symptom intent', () => {
    const result = normalizeIntentClassification({
      ...baseClassification,
      intent: 'emergency',
      entities: { ...baseClassification.entities, reasonForVisit: 'Chest pain' },
      safety: {
        isEmergency: true,
        isMedicalAdviceRequest: false,
        reason: 'emergency_symptoms_detected',
      },
    });
    expect(result.normalizedIntent).toBe('emergency');
    expect(result.normalizationReason).toBeNull();
  });

  it('does not override medical advice intent', () => {
    const result = normalizeIntentClassification({
      ...baseClassification,
      intent: 'medical_advice_request',
      entities: { ...baseClassification.entities, reasonForVisit: 'Fever' },
      safety: {
        isEmergency: false,
        isMedicalAdviceRequest: true,
        reason: 'medication_advice_request',
      },
    });
    expect(result.normalizedIntent).toBe('medical_advice_request');
  });

  it('uses active_flow_answer when active booking prompt exists', () => {
    const collected = attachActivePrompt(
      {},
      buildActivePromptSnapshot('ASK_PROBLEM_OR_DOCTOR', 'booking.greeting', {
        flow: 'booking',
        expectedFields: ['reason', 'doctor', 'date'],
      }),
    );
    const result = normalizeIntentClassification(
      {
        ...baseClassification,
        entities: { ...baseClassification.entities, reasonForVisit: null },
      },
      { collected, currentFlow: 'none', currentState: 'IDLE' },
    );
    expect(result.normalizedIntent).toBe('active_flow_answer');
    expect(result.normalizationReason).toBe('active_booking_prompt');
  });
});
