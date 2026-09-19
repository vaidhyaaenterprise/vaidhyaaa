import { describe, expect, it } from 'vitest';

import { scheduleConflictItemSchema } from './conflicts';

describe('schedule conflict contract', () => {
  it('accepts safe appointment display details', () => {
    const result = scheduleConflictItemSchema.parse({
      appointment_id: '00000000-0000-0000-0000-000000000123',
      appointment: {
        patient_name: 'Asha Patient',
        appointment_start: '2026-09-21 09:30:00',
        appointment_end: '2026-09-21 10:00:00',
        doctor_name: 'Dr. Test',
        service_name: 'General consultation',
        status: 'confirmed',
      },
      reason: 'outside_clinic_hours',
    });

    expect(result.appointment?.patient_name).toBe('Asha Patient');
    expect(result.appointment).not.toHaveProperty('patient_phone');
  });

  it('keeps appointment details optional for rolling deployments', () => {
    expect(
      scheduleConflictItemSchema.safeParse({
        appointment_id: '00000000-0000-0000-0000-000000000123',
        reason: 'outside_clinic_hours',
      }).success,
    ).toBe(true);
  });
});
