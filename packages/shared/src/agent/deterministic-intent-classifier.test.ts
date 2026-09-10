import { describe, expect, it } from 'vitest';

import { tryDeterministicIntentClassification } from './mock-intent-classifier';

describe('tryDeterministicIntentClassification', () => {
  const baseInput = {
    clinicId: '00000000-0000-0000-0000-000000000001',
    messageText: '',
    currentFlow: 'none',
    currentState: 'IDLE',
    languageCode: 'ta_tanglish',
  };

  it('classifies fever symptom at idle without LLM', () => {
    const result = tryDeterministicIntentClassification({
      ...baseInput,
      messageText: 'Fever ku',
    });
    expect(result?.intent).toBe('book_appointment');
    expect(result?.entities.reasonForVisit).toBe('fever');
  });
});
