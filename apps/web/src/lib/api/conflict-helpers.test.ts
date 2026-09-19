import { describe, expect, it } from 'vitest';

import type { ScheduleConflictItem } from '@vaidya/shared';

import { formatScheduleConflicts } from '@/lib/api/conflict-helpers';

const appointment = {
  patient_name: 'Asha Patient',
  appointment_start: '2026-09-21 09:30:00',
  appointment_end: '2026-09-21 10:00:00',
  doctor_name: 'Dr. Test',
  service_name: 'General consultation',
  status: 'confirmed' as const,
};

function appointmentConflict(reason: string): ScheduleConflictItem {
  return {
    appointment_id: '00000000-0000-0000-0000-000000000123',
    appointment,
    reason,
  };
}

describe('formatScheduleConflicts', () => {
  it.each([
    ['outside_clinic_hours', 'falls outside the new clinic hours'],
    ['outside_doctor_hours', "falls outside the doctor's new working hours"],
    ['active_appointment_on_holiday', 'conflicts with the proposed holiday'],
  ])('shows appointment details rather than IDs for %s', (reason, expectedEnding) => {
    const [message] = formatScheduleConflicts([appointmentConflict(reason)]);

    expect(message).toContain('Asha Patient');
    expect(message).toContain('21 Sep 2026 09:30 - 10:00');
    expect(message).toContain('Doctor: Dr. Test');
    expect(message).toContain('Service: General consultation');
    expect(message).toContain('Status: Confirmed');
    expect(message).toContain(expectedEnding);
    expect(message).not.toContain('00000000-0000-0000-0000-000000000123');
  });

  it('uses a readable rolling-deployment fallback without exposing an appointment ID', () => {
    const [message] = formatScheduleConflicts([
      {
        appointment_id: '00000000-0000-0000-0000-000000000123',
        reason: 'outside_clinic_hours',
      },
    ]);

    expect(message).toBe('An existing appointment — falls outside the new clinic hours');
    expect(message).not.toContain('00000000-0000-0000-0000-000000000123');
  });

  it('shows slot timing and never exposes slot IDs', () => {
    const [message] = formatScheduleConflicts([
      {
        slot_id: '00000000-0000-0000-0000-000000000456',
        slot_start: '2026-09-21 11:00:00',
        slot_end: '2026-09-21 11:30:00',
        reason: 'occupied_exceeds_new_capacity',
      },
    ]);

    expect(message).toContain('21 Sep 2026 11:00 - 11:30');
    expect(message).not.toContain('00000000-0000-0000-0000-000000000456');
  });

  it('handles malformed conflict details without throwing or exposing IDs', () => {
    const [message] = formatScheduleConflicts([
      {
        appointment_id: '00000000-0000-0000-0000-000000000123',
        appointment: { patient_name: 'Incomplete payload' },
        reason: 'outside_clinic_hours',
      },
    ]);

    expect(message).toBe('This schedule change conflicts with existing bookings');
    expect(message).not.toContain('00000000-0000-0000-0000-000000000123');
  });
});
