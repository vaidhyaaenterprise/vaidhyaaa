import { describe, expect, it } from 'vitest';

import { assertTemplateRegistryComplete } from '../templates/index';
import { LlmJsonParser } from './llm-json-parser';
import { classifyIntentMock } from './mock-intent-classifier';

describe('shared A01 helpers', () => {
  it('template registry is complete', () => {
    expect(() => assertTemplateRegistryComplete()).not.toThrow();
  });

  it('json parser handles common LLM response shapes', () => {
    const parser = new LlmJsonParser();
    expect(parser.parseObject('{"intent":"ask_fee"}').ok).toBe(true);
    expect(parser.parseObject('Result: {"intent":"ask_fee"} thanks').ok).toBe(true);
    expect(parser.parseObject('broken').ok).toBe(false);
  });

  it('mock classifier prioritizes emergency over booking', () => {
    const result = classifyIntentMock({
      clinicId: '00000000-0000-0000-0000-000000000001',
      messageText: 'Chest pain irukku appointment venum',
      currentFlow: 'none',
      currentState: 'IDLE',
      languageCode: 'ta_tanglish',
    });
    expect(result.intent).toBe('emergency');
  });
});
