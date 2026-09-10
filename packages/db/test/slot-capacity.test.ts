import { describe, expect, it } from 'vitest';

import { hasCapacityToConvertHold } from '../src/services/slot-capacity';

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
