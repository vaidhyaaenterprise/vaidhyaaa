import { describe, expect, it } from 'vitest';

import { resolveContextSensitiveAnswer } from './context-sensitive-interpreter';
import {
  appendWordsToLanguagePackField,
  isEligibleLanguagePackToken,
  proposeLanguagePackAdditionsFromReviewedExamples,
} from './language-pack-maintenance';
import { getDefaultLanguagePack } from './language-pack';
import { interpretLanguagePackFastPath } from './language-pack-fast-path';

describe('A18 language pack maintenance', () => {
  it('accepts short reusable tokens and rejects long sentences', () => {
    expect(isEligibleLanguagePackToken('vendaam')).toBe(true);
    expect(isEligibleLanguagePackToken('saringa')).toBe(true);
    expect(
      isEligibleLanguagePackToken(
        'I want to book an appointment tomorrow evening for knee pain with Dr Kumar please',
      ),
    ).toBe(false);
  });

  it('proposes pack additions only for eligible reviewed examples', () => {
    const { proposals, rejected } = proposeLanguagePackAdditionsFromReviewedExamples([
      {
        id: '1',
        languageCode: 'ta_tanglish',
        messageTextRedacted: 'vendaam',
        contextFlow: 'booking',
        contextState: 'CONFIRM_DOCTOR',
        expectedRecognizedAs: 'flow_cancel',
        expectedIntent: null,
        expectedEntitiesJson: {},
      },
      {
        id: '2',
        languageCode: 'ta_tanglish',
        messageTextRedacted:
          'I want to book an appointment tomorrow evening for knee pain with Dr Kumar please',
        contextFlow: 'booking',
        contextState: 'ASK_DATE',
        expectedRecognizedAs: 'date_answer',
        expectedIntent: 'book_appointment',
        expectedEntitiesJson: { dateKind: 'tomorrow' },
      },
    ]);

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.word).toBe('vendaam');
    expect(proposals[0]?.field).toBe('no_words');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBe('ineligible_token');
  });

  it('updates parser behavior without booking machine changes', () => {
    const pack = appendWordsToLanguagePackField(getDefaultLanguagePack('ta_tanglish'), 'yes_words', [
      'saringa',
    ]);
    const confirm = interpretLanguagePackFastPath(
      {
        clinicId: '00000000-0000-0000-0000-000000000001',
        sessionId: '00000000-0000-0000-0000-000000000099',
        currentFlow: 'booking',
        currentState: 'CONFIRM_DOCTOR',
        languageCode: 'ta_tanglish',
        messageText: 'saringa',
        timezone: 'Asia/Kolkata',
        referenceDate: '2026-05-16',
        collected: {},
        expectedFields: ['yes_confirmation'],
      },
      pack,
    );
    expect(confirm?.recognizedAs).toBe('yes_confirmation');

    const cancel = resolveContextSensitiveAnswer(
      {
        clinicId: '00000000-0000-0000-0000-000000000001',
        sessionId: '00000000-0000-0000-0000-000000000099',
        currentFlow: 'booking',
        currentState: 'CONFIRM_DOCTOR',
        languageCode: 'ta_tanglish',
        messageText: 'vendaam',
        timezone: 'Asia/Kolkata',
        referenceDate: '2026-05-16',
        collected: {},
        expectedFields: ['yes_confirmation', 'no_rejection'],
      },
      appendWordsToLanguagePackField(getDefaultLanguagePack('ta_tanglish'), 'no_words', ['vendaam']),
    );
    expect(cancel?.recognizedAs).toBe('flow_cancel');

    const tomorrow = interpretLanguagePackFastPath(
      {
        clinicId: '00000000-0000-0000-0000-000000000001',
        sessionId: '00000000-0000-0000-0000-000000000099',
        currentFlow: 'booking',
        currentState: 'ASK_DATE',
        languageCode: 'ta_tanglish',
        messageText: 'nalikki',
        timezone: 'Asia/Kolkata',
        referenceDate: '2026-05-16',
        collected: {},
        expectedFields: ['date'],
      },
      appendWordsToLanguagePackField(getDefaultLanguagePack('ta_tanglish'), 'tomorrow_words', [
        'nalikki',
      ]),
    );
    expect(tomorrow?.recognizedAs).toBe('date_answer');
    expect(tomorrow?.entities.date).toBe('2026-05-17');
  });
});
