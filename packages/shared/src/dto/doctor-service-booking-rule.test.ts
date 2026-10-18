import { describe, expect, it } from 'vitest';
import { createBookingRuleSchema, updateBookingRuleSchema } from './doctor-service-booking-rule';

describe('minimum slot duration', () => {
  it.each([0, 5, 10, 14, 14.5, -15, '15'])(
    'rejects duration %s in creation and updates',
    (duration) => {
      expect(updateBookingRuleSchema.safeParse({ slot_duration_minutes: duration }).success).toBe(
        false,
      );
      expect(
        createBookingRuleSchema.safeParse({
          doctor_id: '00000000-0000-0000-0000-000000000201',
          clinic_service_id: '00000000-0000-0000-0000-000000000301',
          slot_duration_minutes: duration,
          capacity_per_slot: 3,
        }).success,
      ).toBe(false);
    },
  );
  it.each([15, 20, 30, 60, 120])('allows duration %s', (duration) => {
    expect(updateBookingRuleSchema.safeParse({ slot_duration_minutes: duration }).success).toBe(
      true,
    );
  });
});
