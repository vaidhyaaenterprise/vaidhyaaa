import { describe, expect, it } from 'vitest';
import {
  BOOKING_HORIZON_DAYS,
  createBookingRuleSchema,
  updateBookingRuleSchema,
} from './doctor-service-booking-rule';

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

describe('fixed booking window and retired edit settings', () => {
  const createInput = {
    doctor_id: '00000000-0000-0000-0000-000000000201',
    clinic_service_id: '00000000-0000-0000-0000-000000000301',
    slot_duration_minutes: 30,
    capacity_per_slot: 3,
  };

  it('defaults new rules to 45 days without adding retired settings', () => {
    const rule = createBookingRuleSchema.parse(createInput);
    expect(rule.booking_horizon_days).toBe(BOOKING_HORIZON_DAYS);
    expect(rule).not.toHaveProperty('manual_edit_cutoff_before_start_minutes');
    expect(rule).not.toHaveProperty('manual_edit_max_shift_minutes');
    expect(updateBookingRuleSchema.parse({ capacity_per_slot: 2 })).toEqual({
      capacity_per_slot: 2,
    });
  });

  it.each([1, 30, 46, 180])('rejects a configurable horizon of %s days', (days) => {
    expect(
      createBookingRuleSchema.safeParse({ ...createInput, booking_horizon_days: days }).success,
    ).toBe(false);
    expect(updateBookingRuleSchema.safeParse({ booking_horizon_days: days }).success).toBe(false);
  });

  it('ignores retired fields from older clients rather than persisting them', () => {
    expect(
      updateBookingRuleSchema.parse({
        capacity_per_slot: 2,
        manual_edit_cutoff_before_start_minutes: 90,
        manual_edit_max_shift_minutes: 120,
      }),
    ).toEqual({ capacity_per_slot: 2 });
  });
});
