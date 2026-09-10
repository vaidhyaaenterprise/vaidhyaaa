import { describe, expect, it } from 'vitest';

import { hasBookingProgress, inferBookingState, resumeBookingSession } from './booking-progress';

describe('booking-progress', () => {
  it('resumes booking session when collected has reason but flow is none', () => {
    const resumed = resumeBookingSession({
      currentFlow: 'none',
      currentState: 'IDLE',
      collectedJson: { reason_for_visit: 'knee pain' },
    });

    expect(resumed.currentFlow).toBe('booking');
    expect(resumed.currentState).toBe('ASK_DATE');
    expect(hasBookingProgress({ reason_for_visit: 'knee pain' })).toBe(true);
  });

  it('infers ASK_REASON when date exists but reason does not', () => {
    expect(inferBookingState({ preferred_date: '2026-06-29' })).toBe('ASK_REASON');
  });

  it('infers ASK_DATE when reason exists but date does not', () => {
    expect(inferBookingState({ reason_for_visit: 'fever' })).toBe('ASK_DATE');
  });

  it('infers ASK_REASON when doctor name exists but reason does not', () => {
    expect(inferBookingState({ doctor_name: 'Kumar' })).toBe('ASK_REASON');
    expect(hasBookingProgress({ doctor_name: 'Kumar' })).toBe(true);
  });

  it('advances past PROPOSE_SLOTS when a slot is already selected', () => {
    expect(
      inferBookingState({
        reason_for_visit: 'knee pain',
        doctor_name: 'Murugan',
        preferred_date: '2026-07-13',
        time_preference: 'evening',
        selected_slot_id: '00000000-0000-0000-0000-000000000501',
      }),
    ).toBe('ASK_PATIENT_NAME');
  });
});
