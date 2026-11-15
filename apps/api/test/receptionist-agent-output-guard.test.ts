import { describe, expect, it } from 'vitest';

import {
  buildAllowedFactSnapshot,
  detectUngroundedFacts,
} from '../src/modules/conversation/receptionist-agent-output-guard';

describe('receptionist agent availability output grounding', () => {
  it('allows returned window boundaries and frequency while rejecting invented times', () => {
    const snapshot = buildAllowedFactSnapshot({
      collected: { doctor_name: 'Dr. Test' },
      toolResults: [
        {
          toolName: 'check_slot_availability',
          result: {
            doctorName: 'Dr. Test',
            availabilityWindowsText: '10:00-13:00, 14:00-18:00',
            slotFrequencyMinutes: 30,
            nearbySlotsText: '',
            slots: [],
          },
        },
      ],
    });

    expect(
      detectUngroundedFacts(
        'Dr. Test is available from 10:00-13:00 and 14:00-18:00, every 30 minutes.',
        snapshot,
      ),
    ).toEqual([]);
    expect(detectUngroundedFacts('Dr. Test is available at 19:00.', snapshot)).toContain(
      'time:19:00',
    );
  });
});
