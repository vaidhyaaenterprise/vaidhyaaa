import { describe, expect, it } from 'vitest';

import {
  classifyIntentMock,
  isProcedureFeeFromClassification,
  LOW_INTENT_CONFIDENCE,
  templateKeyForIntent,
} from '@vaidya/shared';

const baseInput = {
  clinicId: '00000000-0000-0000-0000-000000000001',
  currentFlow: 'none',
  currentState: 'IDLE',
  languageCode: 'ta_tanglish',
  knownCollectedFields: {},
};

describe('A11 global NLU classifier hardening', () => {
  it('1. Naalaikku evening appointment venum -> book_appointment', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Naalaikku evening appointment venum',
    });
    expect(result.intent).toBe('book_appointment');
  });

  it('2. Doctor-a paakanum -> book_appointment', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Doctor-a paakanum',
    });
    expect(result.intent).toBe('book_appointment');
  });

  it('3. Token venum -> book_appointment', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Token venum',
    });
    expect(result.intent).toBe('book_appointment');
  });

  it('4. Fever-ku enna tablet? -> medical_advice_request', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Fever-ku enna tablet?',
    });
    expect(result.intent).toBe('medical_advice_request');
  });

  it('5. Chest pain irukku appointment venum -> emergency', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Chest pain irukku appointment venum',
    });
    expect(result.intent).toBe('emergency');
  });

  it('6. MRI scan fee evlo? -> ask_fee with procedure fee category', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'MRI scan fee evlo?',
    });
    expect(result.intent).toBe('ask_fee');
    expect(result.entities.feeCategory).toBe('procedure');
    expect(isProcedureFeeFromClassification(result)).toBe(true);
  });

  it('7. Sunday open-a? -> ask_timing', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Sunday open-a?',
    });
    expect(result.intent).toBe('ask_timing');
  });

  it('8. Dr Priya inniku irukkangala? -> ask_doctor_availability', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Dr Priya inniku irukkangala?',
    });
    expect(result.intent).toBe('ask_doctor_availability');
  });

  it('9. Scan-ku sapdalaama? -> ask_previsit_instruction', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Scan-ku sapdalaama?',
    });
    expect(result.intent).toBe('ask_previsit_instruction');
  });

  it('10. Receptionist kitta pesanum -> ask_human_agent', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Receptionist kitta pesanum',
    });
    expect(result.intent).toBe('ask_human_agent');
  });

  it('11. English please -> language_switch', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'English please',
    });
    expect(result.intent).toBe('language_switch');
  });

  it('12. Cricket score enna? -> out_of_scope', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Cricket score enna?',
    });
    expect(result.intent).toBe('out_of_scope');
  });

  it('12b. tattoo removal venum -> unsupported_service', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Tattoo removal venum',
    });
    expect(result.intent).toBe('unsupported_service');
  });

  it('12c. spec examples fever appointment and tooth extraction previsit', () => {
    expect(
      classifyIntentMock({ ...baseInput, messageText: 'fever appointment venum' }).intent,
    ).toBe('book_appointment');
    expect(
      classifyIntentMock({ ...baseInput, messageText: 'tooth extraction-ku fasting venuma' }).intent,
    ).toBe('ask_previsit_instruction');
  });

  it('12d. Vanakkam -> greeting_smalltalk', () => {
    const result = classifyIntentMock({ ...baseInput, messageText: 'Vanakkam' });
    expect(result.intent).toBe('greeting_smalltalk');
  });

  it('13. low-confidence -> safe unknown.clarify', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: '???',
    });
    expect(result.intent).toBe('unknown');
    expect(result.needsClarification).toBe(true);
    expect(result.confidence).toBeLessThanOrEqual(LOW_INTENT_CONFIDENCE);
    expect(templateKeyForIntent(result.intent)).toBe('unknown.clarify');
  });

  it('14. real provider not required for CI', () => {
    expect(() =>
      classifyIntentMock({
        ...baseInput,
        messageText: 'Naalaikku evening appointment venum',
      }),
    ).not.toThrow();
  });
});
