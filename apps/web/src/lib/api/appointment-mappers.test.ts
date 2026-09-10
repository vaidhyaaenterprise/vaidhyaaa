import { describe, expect, it } from 'vitest';

import { mapAppointmentRow } from '@/lib/api/appointment-mappers';
import type { AppointmentApiRow } from '@/lib/api/appointments';

function buildRow(appointmentStart: string): AppointmentApiRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    patient_name: 'Test Patient',
    patient_phone: '+919876543210',
    doctor_id: '22222222-2222-2222-2222-222222222222',
    doctor_name: 'Dr. Murugan',
    clinic_service_id: '33333333-3333-3333-3333-333333333333',
    service_name: 'General Consultation',
    appointment_start: appointmentStart,
    appointment_end: '2026-08-03 00:30:00',
    reason_for_visit: 'Body pain',
    visit_type: 'new',
    routing_source: 'manual',
    source: 'manual',
    status: 'confirmed',
    has_history: false,
  };
}

describe('mapAppointmentRow', () => {
  it('maps timestamp values when appointment_start uses a T separator', () => {
    const appointment = mapAppointmentRow(buildRow('2026-08-03T00:00:00'));

    expect(appointment.appointmentDate).toBe('2026-08-03');
    expect(appointment.appointmentTime).toBe('00:00');
  });

  it('maps timestamp values when appointment_start uses a space separator', () => {
    const appointment = mapAppointmentRow(buildRow('2026-08-03 00:00:00'));

    expect(appointment.appointmentDate).toBe('2026-08-03');
    expect(appointment.appointmentTime).toBe('00:00');
  });
});
