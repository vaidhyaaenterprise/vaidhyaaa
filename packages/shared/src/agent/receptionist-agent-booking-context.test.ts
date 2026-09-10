import { describe, expect, it } from 'vitest';

import { buildReceptionistAgentBookingContext } from './receptionist-agent-booking-context';

describe('receptionist-agent-booking-context', () => {
  it('guides ASK_DATE when reason is already collected', () => {
    const context = buildReceptionistAgentBookingContext({
      messageText: 'Knee pain appointment venum',
      languageCode: 'ta_tanglish',
      collected: { reason_for_visit: 'knee pain' },
    });

    expect(context).toMatchObject({
      state: 'ASK_DATE',
      next_action: 'ask_preferred_date',
      in_booking: true,
    });
    expect(context?.example_reply).toContain('date');
    expect(context?.reply_rules.some((rule) => rule.includes('ONE short question'))).toBe(true);
  });

  it('flags meta question when patient asks what details are needed', () => {
    const context = buildReceptionistAgentBookingContext({
      messageText: 'I need few more details before booking',
      languageCode: 'english',
      collected: {},
    });

    expect(context?.patient_move).toBe('meta_question_what_details_needed');
    expect(context?.reply_rules[0]).toContain('single next field');
  });

  it('returns null for unrelated smalltalk', () => {
    const context = buildReceptionistAgentBookingContext({
      messageText: 'Thanks',
      languageCode: 'english',
      collected: {},
    });

    expect(context).toBeNull();
  });
});
