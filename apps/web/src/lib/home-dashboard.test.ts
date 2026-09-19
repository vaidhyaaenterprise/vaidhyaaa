import { describe, expect, it } from 'vitest';

import type { Appointment } from '@/components/pages/appointments/types';
import { getClinicDate, groupHomeAppointments } from '@/lib/home-dashboard';

function appointment(
  id: string,
  appointmentDate: string,
  appointmentTime: string,
  status: Appointment['status'],
): Appointment {
  return {
    id,
    patientName: `Patient ${id}`,
    patientPhone: '+919876543210',
    doctorId: 'doctor-1',
    doctorName: 'Dr. Test',
    serviceId: 'service-1',
    serviceName: 'Consultation',
    appointmentDate,
    appointmentTime,
    reasonForVisit: 'Checkup',
    visitType: 'new',
    routingSource: 'manual_booking',
    source: 'manual',
    status,
    hasHistory: false,
  };
}

describe('getClinicDate', () => {
  it('uses the clinic timezone across the Asia/Kolkata UTC date boundary', () => {
    expect(getClinicDate(new Date('2026-09-18T18:29:59.000Z'), 'Asia/Kolkata')).toBe('2026-09-18');
    expect(getClinicDate(new Date('2026-09-18T18:30:00.000Z'), 'Asia/Kolkata')).toBe('2026-09-19');
  });
});

describe('groupHomeAppointments', () => {
  it('classifies only current-day active and earlier unresolved appointments', () => {
    const groups = groupHomeAppointments(
      [
        appointment('today-pending', '2026-09-19', '09:30', 'pending_confirmation'),
        appointment('today-confirmed', '2026-09-19', '10:00', 'confirmed'),
        appointment('past-pending', '2026-09-18', '11:00', 'pending_confirmation'),
        appointment('past-confirmed', '2026-09-18', '12:00', 'confirmed'),
        appointment('future-pending', '2026-09-20', '09:00', 'pending_confirmation'),
        appointment('today-visited', '2026-09-19', '08:00', 'visited'),
        appointment('today-cancelled', '2026-09-19', '08:30', 'cancelled'),
      ],
      '2026-09-19',
    );

    expect(groups.todayPending.map(({ id }) => id)).toEqual(['today-pending']);
    expect(groups.missedPending.map(({ id }) => id)).toEqual(['past-pending']);
    expect(groups.todayAppointments.map(({ id }) => id)).toEqual([
      'today-pending',
      'today-confirmed',
    ]);
  });

  it('sorts today ascending, missed appointments recent-first, and uses id as a tie-breaker', () => {
    const groups = groupHomeAppointments(
      [
        appointment('today-b', '2026-09-19', '09:00', 'pending_confirmation'),
        appointment('today-a', '2026-09-19', '09:00', 'pending_confirmation'),
        appointment('today-earliest', '2026-09-19', '08:30', 'confirmed'),
        appointment('missed-older', '2026-09-17', '16:00', 'pending_confirmation'),
        appointment('missed-newer-b', '2026-09-18', '10:00', 'pending_confirmation'),
        appointment('missed-newer-a', '2026-09-18', '10:00', 'pending_confirmation'),
      ],
      '2026-09-19',
      10,
    );

    expect(groups.todayPending.map(({ id }) => id)).toEqual(['today-a', 'today-b']);
    expect(groups.todayAppointments.map(({ id }) => id)).toEqual([
      'today-earliest',
      'today-a',
      'today-b',
    ]);
    expect(groups.missedPending.map(({ id }) => id)).toEqual([
      'missed-newer-a',
      'missed-newer-b',
      'missed-older',
    ]);
  });

  it('limits next appointments without limiting today or missed pending groups', () => {
    const groups = groupHomeAppointments(
      [
        appointment('one', '2026-09-19', '08:00', 'pending_confirmation'),
        appointment('two', '2026-09-19', '09:00', 'confirmed'),
        appointment('three', '2026-09-19', '10:00', 'pending_confirmation'),
        appointment('four', '2026-09-19', '11:00', 'confirmed'),
        appointment('missed', '2026-09-18', '11:00', 'pending_confirmation'),
      ],
      '2026-09-19',
      3,
    );

    expect(groups.todayAppointments.map(({ id }) => id)).toEqual(['one', 'two', 'three']);
    expect(groups.todayPending.map(({ id }) => id)).toEqual(['one', 'three']);
    expect(groups.missedPending.map(({ id }) => id)).toEqual(['missed']);
  });
});
