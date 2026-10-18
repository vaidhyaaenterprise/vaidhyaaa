import { describe, expect, it } from 'vitest';
import { replaceDoctorSchedulesSchema } from './doctor-schedule';

const window = { day_of_week: 1, start_time: '09:00', end_time: '13:00', active: true };
describe('doctor working hours validation', () => {
  it('rejects overlaps including nested and duplicate windows', () => {
    for (const other of [
      window,
      { ...window, start_time: '12:00', end_time: '14:00' },
      { ...window, start_time: '10:00', end_time: '11:00' },
    ]) {
      expect(replaceDoctorSchedulesSchema.safeParse({ windows: [window, other] }).success).toBe(
        false,
      );
    }
  });
  it('allows adjacent windows, other weekdays and inactive windows', () => {
    for (const other of [
      { ...window, start_time: '13:00', end_time: '14:00' },
      { ...window, day_of_week: 2 },
      { ...window, active: false },
    ]) {
      expect(replaceDoctorSchedulesSchema.safeParse({ windows: [window, other] }).success).toBe(
        true,
      );
    }
  });
  it('allows nonoverlapping effective date ranges but rejects a shared boundary date', () => {
    const first = { ...window, effective_to: '2026-10-20' };
    expect(
      replaceDoctorSchedulesSchema.safeParse({
        windows: [first, { ...window, effective_from: '2026-10-21' }],
      }).success,
    ).toBe(true);
    expect(
      replaceDoctorSchedulesSchema.safeParse({
        windows: [first, { ...window, effective_from: '2026-10-20' }],
      }).success,
    ).toBe(false);
  });
  it('rejects invalid and reversed times and dates', () => {
    for (const invalid of [
      { ...window, start_time: '24:00' },
      { ...window, end_time: '09:00' },
      { ...window, start_time: '13:00', end_time: '09:00' },
      { ...window, effective_from: '2026-10-21', effective_to: '2026-10-20' },
    ]) {
      expect(replaceDoctorSchedulesSchema.safeParse({ windows: [invalid] }).success).toBe(false);
    }
  });
});
