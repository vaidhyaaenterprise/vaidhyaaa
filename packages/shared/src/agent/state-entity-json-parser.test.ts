import { describe, expect, it } from 'vitest';

import { parseStateEntityExtractorJson } from './state-entity-json-parser';

const bookingReasonContext = {
  currentFlow: 'booking',
  currentState: 'ASK_PROBLEM_OR_DOCTOR',
  messageText: 'Fever',
  referenceDate: '2026-06-17',
};

const bookingDateContext = {
  currentFlow: 'booking',
  currentState: 'ASK_DATE',
  messageText: 'June 30',
  referenceDate: '2026-06-17',
};

describe('parseStateEntityExtractorJson', () => {
  it('accepts strict schema JSON', () => {
    const parsed = parseStateEntityExtractorJson(
      JSON.stringify({
        recognizedAs: 'service_answer',
        confidence: 0.92,
        entities: { reasonForVisit: 'Fever' },
        needsClarification: false,
      }),
      bookingReasonContext,
    );

    expect(parsed?.recognizedAs).toBe('service_answer');
    expect(parsed?.entities.reasonForVisit).toBe('Fever');
  });

  it('normalizes Sarvam drift: reasonForVisit without recognizedAs', () => {
    const parsed = parseStateEntityExtractorJson(
      JSON.stringify({
        service_answer: 'Fever is a common symptom.',
        reasonForVisit: 'Fever',
        flow: 'booking',
        state: 'ASK_PROBLEM_OR_DOCTOR',
        ref: '2026-06-27',
        expect: ['reason', 'doctor'],
        entities: {
          date: '2026-06-27',
          reasonForVisit: 'Fever',
          needsClarification: false,
          clarificationReason: null,
        },
        sideQuestionIntent: null,
        sideQuestionTopic: null,
      }),
      bookingReasonContext,
    );

    expect(parsed?.recognizedAs).toBe('service_answer');
    expect(parsed?.entities.reasonForVisit).toBe('Fever');
    expect(parsed?.entities.date).toBeNull();
    expect(parsed?.needsClarification).toBe(false);
    expect(parsed?.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('parses June 30 at ASK_DATE even when LLM omits recognizedAs', () => {
    const parsed = parseStateEntityExtractorJson(
      JSON.stringify({
        entities: { date: 'June 30' },
        needsClarification: false,
      }),
      bookingDateContext,
    );

    expect(parsed?.recognizedAs).toBe('date_answer');
    expect(parsed?.entities.date).toBe('2026-06-30');
    expect(parsed?.entities.reasonForVisit).toBeNull();
  });

  it('parses June 30 at ASK_DATE from message when LLM JSON is empty', () => {
    const parsed = parseStateEntityExtractorJson(
      JSON.stringify({
        recognizedAs: 'unknown',
        entities: {},
      }),
      bookingDateContext,
    );

    expect(parsed?.recognizedAs).toBe('date_answer');
    expect(parsed?.entities.date).toBe('2026-06-30');
  });

  it('parses knee pain at ASK_DATE from message when LLM JSON is empty', () => {
    const parsed = parseStateEntityExtractorJson(
      JSON.stringify({
        recognizedAs: 'unknown',
        entities: {},
      }),
      {
        currentFlow: 'booking',
        currentState: 'ASK_DATE',
        messageText: 'Knee Pain',
        referenceDate: '2026-06-17',
      },
    );

    expect(parsed?.recognizedAs).toBe('service_answer');
    expect(parsed?.entities.reasonForVisit).toBe('knee pain');
  });

  it('infers doctor_answer from doctorName in drift payload', () => {
    const parsed = parseStateEntityExtractorJson(
      JSON.stringify({
        entities: { doctorName: 'Kumar' },
      }),
      {
        currentFlow: 'booking',
        currentState: 'ASK_PROBLEM_OR_DOCTOR',
        messageText: 'Dr Kumar',
        referenceDate: '2026-06-17',
      },
    );

    expect(parsed?.recognizedAs).toBe('doctor_answer');
    expect(parsed?.entities.doctorName).toBe('Kumar');
  });
});
