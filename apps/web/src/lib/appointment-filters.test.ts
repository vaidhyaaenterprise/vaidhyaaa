import { describe, expect, it } from 'vitest';

import type { Appointment } from '@/components/pages/appointments/types';
import { filterCurrentAndFuturePendingAppointments } from '@/lib/appointment-filters';

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
