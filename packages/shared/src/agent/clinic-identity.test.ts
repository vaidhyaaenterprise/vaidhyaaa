import { describe, expect, it } from 'vitest';

import { selectOfferedSlot } from './active-state-parsers';
import {
  isClinicIdentityQuestion,
  messageReferencesClinicName,
  shouldTryKnowledgeBeforeClarify,
} from './clinic-identity';

describe('clinic identity helpers', () => {
  it('detects clinic identity questions', () => {
    expect(isClinicIdentityQuestion('Ithu Sri Murugan Clinic ah')).toBe(true);
    expect(isClinicIdentityQuestion('Is this the right clinic?')).toBe(true);
    expect(isClinicIdentityQuestion('Hello')).toBe(false);
  });

  it('matches clinic name fragments in message', () => {
    expect(messageReferencesClinicName('Ithu Sri Murugan Clinic ah', 'Sri Murugan Clinic')).toBe(true);
    expect(messageReferencesClinicName('Other hospital ah', 'Sri Murugan Clinic')).toBe(false);
  });

  it('allows knowledge fallback for unknown non-greeting questions', () => {
    expect(shouldTryKnowledgeBeforeClarify('unknown', 'Parking irukka?')).toBe(true);
    expect(shouldTryKnowledgeBeforeClarify('unknown', 'Hello')).toBe(false);
    expect(shouldTryKnowledgeBeforeClarify('greeting', 'Parking irukka?')).toBe(false);
  });
});

describe('selectOfferedSlot evening display', () => {
  it('matches 8:00 against offered evening slot list', () => {
    const selection = selectOfferedSlot('8:00', [
      {
        slotId: 'slot-8',
        startTime: '2026-07-03 20:00:00',
        endTime: '2026-07-03 20:30:00',
        displayTime: '8:00',
      },
      {
        slotId: 'slot-830',
        startTime: '2026-07-03 20:30:00',
        endTime: '2026-07-03 21:00:00',
        displayTime: '8:30',
      },
    ]);

    expect(selection.slotId).toBe('slot-8');
    expect(selection.needsClarification).toBe(false);
  });
});
