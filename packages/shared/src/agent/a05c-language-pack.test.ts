import { describe, expect, it } from 'vitest';

import { resolveContextSensitiveAnswer } from './context-sensitive-interpreter';
import { extractStateEntitiesMock } from './mock-state-entity-extractor';
import { getDefaultLanguagePack } from './language-pack';
import { interpretLanguagePackFastPath, runActiveStatePreflight } from './language-pack-fast-path';

function addDaysIso(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

const TIMEZONE = 'Asia/Kolkata';

describe('A05C language pack fast path', () => {
  const base = {
    clinicId: '00000000-0000-0000-0000-000000000001',
    sessionId: '00000000-0000-0000-0000-000000000099',
    currentFlow: 'booking' as const,
    languageCode: 'ta_tanglish',
    timezone: TIMEZONE,
    collected: {},
    expectedFields: ['date'],
  };

  it('matches today and tomorrow spelling variations', () => {
    const today = '2026-05-16';
    const tomorrow = addDaysIso(today, 1);

    for (const message of ['inniku', 'inaiku', 'iniku']) {
      const result = interpretLanguagePackFastPath(
        { ...base, currentState: 'ASK_DATE', messageText: message, referenceDate: today },
        getDefaultLanguagePack('ta_tanglish'),
      );
      expect(result?.recognizedAs).toBe('date_answer');
      expect(result?.entities.date).toBe(today);
    }

    for (const message of ['naalaikku', 'nalaki', 'nalaiku']) {
      const result = interpretLanguagePackFastPath(
        { ...base, currentState: 'ASK_DATE', messageText: message, referenceDate: today },
        getDefaultLanguagePack('ta_tanglish'),
      );
      expect(result?.recognizedAs).toBe('date_answer');
      expect(result?.entities.date).toBe(tomorrow);
    }
  });

  it('matches time preference and exact time', () => {
    const morning = interpretLanguagePackFastPath(
      {
        ...base,
        currentState: 'ASK_TIME',
        messageText: 'morning',
        referenceDate: '2026-05-16',
        expectedFields: ['timePreference'],
      },
      getDefaultLanguagePack('ta_tanglish'),
    );
    expect(morning?.recognizedAs).toBe('time_answer');
    expect(morning?.entities.timePreference).toBe('morning');

    const evening = interpretLanguagePackFastPath(
      {
        ...base,
        currentState: 'ASK_TIME',
        messageText: 'maalai',
        referenceDate: '2026-05-16',
        expectedFields: ['timePreference'],
      },
      getDefaultLanguagePack('ta_tanglish'),
    );
    expect(evening?.entities.timePreference).toBe('evening');

    const exact = interpretLanguagePackFastPath(
      {
        ...base,
        currentState: 'ASK_TIME',
        messageText: '6:30',
        referenceDate: '2026-05-16',
        expectedFields: ['exactTime'],
      },
      getDefaultLanguagePack('ta_tanglish'),
    );
    expect(exact?.recognizedAs).toBe('time_answer');
    expect(exact?.entities.exactTime).toBeTruthy();
  });

  it('matches confirm affirmatives', () => {
    for (const message of ['seri', 'sari', 'ok']) {
      const result = interpretLanguagePackFastPath(
        {
          ...base,
          currentState: 'CONFIRM_DETAILS',
          messageText: message,
          referenceDate: '2026-05-16',
          expectedFields: ['yes_confirmation'],
        },
        getDefaultLanguagePack('ta_tanglish'),
      );
      expect(result?.recognizedAs).toBe('yes_confirmation');
    }
  });
});

describe('A05C context-sensitive negatives', () => {
  const pack = getDefaultLanguagePack('ta_tanglish');

  it('maps booking confirm decline to flow_cancel', () => {
    const result = resolveContextSensitiveAnswer(
      {
        clinicId: '00000000-0000-0000-0000-000000000001',
        sessionId: '00000000-0000-0000-0000-000000000099',
        currentFlow: 'booking',
        currentState: 'CONFIRM_DETAILS',
        languageCode: 'ta_tanglish',
        messageText: 'vendam',
        timezone: TIMEZONE,
        referenceDate: '2026-05-16',
        collected: {},
        expectedFields: ['yes_confirmation', 'no_rejection'],
      },
      pack,
    );
    expect(result?.recognizedAs).toBe('flow_cancel');
  });

  it('maps cancel confirm decline to no_rejection', () => {
    const result = resolveContextSensitiveAnswer(
      {
        clinicId: '00000000-0000-0000-0000-000000000001',
        sessionId: '00000000-0000-0000-0000-000000000099',
        currentFlow: 'cancel',
        currentState: 'CONFIRM_CANCEL_REQUEST',
        languageCode: 'ta_tanglish',
        messageText: 'vendam',
        timezone: TIMEZONE,
        referenceDate: '2026-05-16',
        collected: {},
        expectedFields: ['yes_confirmation', 'no_rejection'],
      },
      pack,
    );
    expect(result?.recognizedAs).toBe('no_rejection');
  });

  it('maps handoff reason decline to flow_cancel', () => {
    const result = resolveContextSensitiveAnswer(
      {
        clinicId: '00000000-0000-0000-0000-000000000001',
        sessionId: '00000000-0000-0000-0000-000000000099',
        currentFlow: 'handoff',
        currentState: 'ASK_REASON',
        languageCode: 'ta_tanglish',
        messageText: 'no',
        timezone: TIMEZONE,
        referenceDate: '2026-05-16',
        collected: {},
        expectedFields: ['reason'],
      },
      pack,
    );
    expect(result?.recognizedAs).toBe('flow_cancel');
  });
});

describe('A05C slot selection', () => {
  const slots = [
    {
      slotId: '11111111-1111-1111-1111-111111111111',
      startTime: '2026-05-16 18:30:00',
      endTime: '2026-05-16 18:45:00',
      displayTime: '6:30 PM',
    },
    {
      slotId: '22222222-2222-2222-2222-222222222222',
      startTime: '2026-05-16 19:15:00',
      endTime: '2026-05-16 19:30:00',
      displayTime: '7:15 PM',
    },
  ];

  it('selects first, second, and earliest offered slots', () => {
    const first = runActiveStatePreflight({
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000099',
      currentFlow: 'booking',
      currentState: 'PROPOSE_SLOTS',
      languageCode: 'ta_tanglish',
      messageText: 'first one',
      timezone: TIMEZONE,
      referenceDate: '2026-05-16',
      collected: {},
      expectedFields: ['slot_selection'],
      offeredSlots: slots,
    });
    expect(first?.recognizedAs).toBe('slot_selection');
    expect(first?.entities.selectedSlotId).toBe(slots[0]!.slotId);

    const second = runActiveStatePreflight({
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000099',
      currentFlow: 'booking',
      currentState: 'PROPOSE_SLOTS',
      languageCode: 'ta_tanglish',
      messageText: 'second one',
      timezone: TIMEZONE,
      referenceDate: '2026-05-16',
      collected: {},
      expectedFields: ['slot_selection'],
      offeredSlots: slots,
    });
    expect(second?.entities.selectedSlotId).toBe(slots[1]!.slotId);

    const earlier = runActiveStatePreflight({
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000099',
      currentFlow: 'booking',
      currentState: 'PROPOSE_SLOTS',
      languageCode: 'ta_tanglish',
      messageText: 'earlier slot',
      timezone: TIMEZONE,
      referenceDate: '2026-05-16',
      collected: {},
      expectedFields: ['slot_selection'],
      offeredSlots: slots,
    });
    expect(earlier?.entities.selectedSlotId).toBe(slots[0]!.slotId);
  });

  it('does not invent slot ids for unavailable times', () => {
    const result = extractStateEntitiesMock({
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000099',
      currentFlow: 'booking',
      currentState: 'PROPOSE_SLOTS',
      languageCode: 'ta_tanglish',
      messageText: '8:00',
      timezone: TIMEZONE,
      referenceDate: '2026-05-16',
      collected: {},
      expectedFields: ['slot_selection'],
      offeredSlots: slots,
    });
    expect(result.recognizedAs).toBe('unknown');
    expect(result.needsClarification).toBe(true);
    expect(result.entities.selectedSlotId).toBeNull();
  });
});
