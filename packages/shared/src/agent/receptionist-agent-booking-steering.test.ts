import { describe, expect, it } from 'vitest';

import { extractActiveDoctorName } from './active-state-parsers';
import {
  extractAgentBookingFieldPatch,
  isMultiQuestionBookingDump,
  shouldSteerBookingReply,
} from './receptionist-agent-booking-steering';

describe('receptionist-agent-booking-steering', () => {
  it('extracts knee pain and doctor Kumar from patient messages', () => {
    expect(
      extractAgentBookingFieldPatch({
        messageText: 'Knee pain ku appointment venum',
        collected: {},
        referenceDate: '2026-07-11',
      }),
    ).toEqual({ reason_for_visit: 'knee pain' });

    expect(extractActiveDoctorName('Doctor Kumar')).toBe('kumar');
    expect(
      extractAgentBookingFieldPatch({
        messageText: 'Doctor Kumar',
        collected: {},
        referenceDate: '2026-07-11',
      }),
    ).toEqual({ doctor_name: 'kumar' });
  });

  it('detects multi-question booking dumps', () => {
    const dump =
      'Enna doctor-a paakanum? Date enna? Time preference morning/afternoon/evening? Patient name sollunga.';
    expect(isMultiQuestionBookingDump(dump)).toBe(true);
    expect(
      shouldSteerBookingReply({
        replyText: dump,
        bookingContext: {
          in_booking: true,
          flow: 'booking',
          state: 'ASK_DATE',
          expected_fields: ['date'],
          missing_fields: ['preferred_date'],
          next_action: 'ask_preferred_date',
          example_reply: 'Enna date-ku appointment venum?',
          reply_rules: [],
          tool_hints: ['update_booking_state'],
        },
      }),
    ).toBe(true);
  });
});
