import { describe, expect, it } from 'vitest';

import {
  correctActiveStateEntityResult,
  tryDeterministicActiveStateEntity,
} from './active-state-parsers';

const baseInput = {
  clinicId: '00000000-0000-0000-0000-000000000001',
  sessionId: '00000000-0000-0000-0000-000000000002',
  currentFlow: 'booking',
  currentState: 'ASK_PROBLEM_OR_DOCTOR',
  languageCode: 'ta_tanglish',
  timezone: 'Asia/Kolkata',
  referenceDate: '2026-06-27',
  collected: {},
  expectedFields: ['reason', 'doctor'],
};

describe('active state entity corrections', () => {
  it('detects fever and knee pain as reason before LLM', () => {
    expect(
      tryDeterministicActiveStateEntity({ ...baseInput, messageText: 'Fever ku' })?.recognizedAs,
    ).toBe('service_answer');
    expect(
      tryDeterministicActiveStateEntity({ ...baseInput, messageText: 'Knee Pain' })?.entities
        .reasonForVisit,
    ).toBe('knee pain');
  });

  it('corrects Sarvam doctor_answer mislabel to service_answer', () => {
    const corrected = correctActiveStateEntityResult(
      { ...baseInput, messageText: 'Knee Pain' },
      {
        recognizedAs: 'doctor_answer',
        confidence: 0.95,
        entities: { doctorName: 'knee pain' },
        needsClarification: false,
      },
    );
    expect(corrected.recognizedAs).toBe('service_answer');
    expect(corrected.entities.reasonForVisit).toBe('knee pain');
    expect(corrected.entities.doctorName).toBeNull();
  });

  it('detects side questions deterministically', () => {
    const result = tryDeterministicActiveStateEntity({
      ...baseInput,
      messageText: 'Fees evlo?',
    });
    expect(result?.recognizedAs).toBe('side_question');
    expect(result?.entities.sideQuestionIntent).toBe('ask_fee');
  });

  it('detects knee pain at ASK_DATE before LLM', () => {
    const result = tryDeterministicActiveStateEntity({
      ...baseInput,
      currentState: 'ASK_DATE',
      messageText: 'Knee Pain',
      expectedFields: ['date', 'timePreference'],
    });
    expect(result?.recognizedAs).toBe('service_answer');
    expect(result?.entities.reasonForVisit).toBe('knee pain');
  });
});
