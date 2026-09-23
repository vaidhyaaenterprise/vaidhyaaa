import { describe, expect, it } from 'vitest';

import type { Appointment } from '@/components/pages/appointments/types';
import {
  filterCurrentAndFutureConfirmedAppointments,
  filterCurrentAndFuturePendingAppointments,
  filterMissedPendingAppointments,
} from '@/lib/appointment-filters';

function appointment(
  id: string,
  appointmentDate: string,
  appointmentTime: string,
  status: Appointment['status'] = 'pending_confirmation',
): Appointment {
  return {
    id,
    patientName: id,
    patientPhone: '9876543210',
    doctorId: 'doctor-1',
    doctorName: 'Doctor',
    serviceId: 'service-1',
    serviceName: 'Consultation',
    appointmentDate,
    appointmentTime,
    reasonForVisit: 'Checkup',
    visitType: 'new',
    routingSource: 'voice_bot',
    source: 'agent',
    status,
    hasHistory: false,
  };
}

describe('filterCurrentAndFuturePendingAppointments', () => {
  it('excludes past pending records while keeping today and future records', () => {
    const result = filterCurrentAndFuturePendingAppointments(
      [
        appointment('future-later', '2026-09-22', '11:00'),
        appointment('past', '2026-09-19', '09:00'),
        appointment('today-later', '2026-09-20', '10:00'),
        appointment('confirmed-future', '2026-09-21', '09:00', 'confirmed'),
        appointment('today-earlier', '2026-09-20', '08:00'),
      ],
      '2026-09-20',
    );

    expect(result.map((item) => item.id)).toEqual([
      'today-earlier',
      'today-later',
      'future-later',
    ]);
  });
});

describe('filterMissedPendingAppointments', () => {
  it('keeps only past pending records and sorts the newest missed action first', () => {
    const result = filterMissedPendingAppointments(
      [
        appointment('older', '2026-09-18', '16:00'),
        appointment('today', '2026-09-20', '08:00'),
        appointment('newer-earlier', '2026-09-19', '09:00'),
        appointment('confirmed-past', '2026-09-19', '12:00', 'confirmed'),
        appointment('newer-later', '2026-09-19', '11:00'),
        appointment('future', '2026-09-21', '10:00'),
      ],
      '2026-09-20',
    );

    expect(result.map((item) => item.id)).toEqual([
      'newer-later',
      'newer-earlier',
      'older',
    ]);
  });
});

describe('filterCurrentAndFutureConfirmedAppointments', () => {
  it('keeps only current and future confirmed records in chronological order', () => {
    const result = filterCurrentAndFutureConfirmedAppointments(
      [
        appointment('future-later', '2026-09-22', '11:00', 'confirmed'),
        appointment('past', '2026-09-19', '09:00', 'confirmed'),
        appointment('today-later', '2026-09-20', '10:00', 'confirmed'),
        appointment('pending-future', '2026-09-21', '09:00'),
        appointment('today-earlier', '2026-09-20', '08:00', 'confirmed'),
      ],
      '2026-09-20',
    );

    expect(result.map((item) => item.id)).toEqual([
      'today-earlier',
      'today-later',
      'future-later',
    ]);
  });
});
