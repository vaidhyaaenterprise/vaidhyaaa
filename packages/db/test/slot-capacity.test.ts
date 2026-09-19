import { describe, expect, it } from 'vitest';

import {
  dayOfWeekMon1,
  hasCapacityToConvertHold,
  toStoredDayOfWeek,
} from '../src/services/slot-capacity';

describe('hasCapacityToConvertHold', () => {
  it('allows conversion when the hold still has a reserved seat', () => {
    expect(
      hasCapacityToConvertHold({
        capacityTotal: 2,
        activeAppointments: 1,
        otherActiveHolds: 0,
      }),
    ).toBe(true);
  });

  it('blocks conversion when appointments already fill the slot', () => {
    expect(
      hasCapacityToConvertHold({
        capacityTotal: 1,
        activeAppointments: 1,
        otherActiveHolds: 0,
      }),
    ).toBe(false);
  });

  it('blocks conversion when other holds and appointments consume capacity', () => {
    expect(
      hasCapacityToConvertHold({
        capacityTotal: 2,
        activeAppointments: 1,
        otherActiveHolds: 1,
      }),
    ).toBe(false);
  });
});

describe('schedule day-of-week conventions', () => {
  it('keeps Mon1 date semantics while converting Sunday for persisted schedules', () => {
    const sundayMon1 = dayOfWeekMon1('2026-06-21', 'Asia/Kolkata');

    expect(sundayMon1).toBe(7);
    expect(toStoredDayOfWeek(sundayMon1)).toBe(0);
    expect(toStoredDayOfWeek(1)).toBe(1);
    expect(toStoredDayOfWeek(6)).toBe(6);
  });
});
