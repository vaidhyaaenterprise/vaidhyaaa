import { describe, expect, it } from 'vitest';

import type { Appointment, AppointmentActivity } from '@/components/pages/appointments/types';
import {
  filterCurrentAndFutureConfirmedAppointments,
  filterCurrentAndFuturePendingAppointments,
  filterMissedPendingAppointments,
  filterRetainedAppointmentActivities,
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

function activity(
  id: string,
  actionType: AppointmentActivity['actionType'],
  appointmentDate: string,
  occurredAt: string,
): AppointmentActivity {
  return {
    id,
    appointmentId: `appointment-${id}`,
    patientName: id,
    patientPhone: '9876543210',
    doctorId: 'doctor-1',
    doctorName: 'Doctor',
    serviceId: 'service-1',
    serviceName: 'Consultation',
    reasonForVisit: 'Checkup',
    actionType,
    occurredAt,
    previousAppointmentDate: '2026-09-15',
    previousAppointmentTime: '09:00',
    appointmentDate,
    appointmentTime: '10:00',
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

    expect(result.map((item) => item.id)).toEqual(['today-earlier', 'today-later', 'future-later']);
  });
});

describe('filterMissedPendingAppointments', () => {
  it('keeps only past pending records and sorts the newest missed action first', () => {
    const result = filterMissedPendingAppointments(
      [
        appointment('expired', '2026-09-16', '17:00'),
        appointment('retention-boundary', '2026-09-17', '08:00'),
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
      'retention-boundary',
    ]);
  });

  it('handles the three-day boundary across calendar months', () => {
    const result = filterMissedPendingAppointments(
      [
        appointment('expired', '2026-09-28', '09:00'),
        appointment('retained', '2026-09-29', '09:00'),
      ],
      '2026-10-02',
    );

    expect(result.map((item) => item.id)).toEqual(['retained']);
  });
});

describe('filterRetainedAppointmentActivities', () => {
  it('retains cancellations for three clinic days and reschedules through three days after the latest appointment', () => {
    const result = filterRetainedAppointmentActivities(
      [
        activity('cancel-boundary', 'cancel', '2026-09-10', '2026-09-16T18:30:00.000Z'),
        activity('cancel-expired', 'cancel', '2026-09-19', '2026-09-16T18:29:59.000Z'),
        activity('reschedule-boundary', 'reschedule', '2026-09-17', '2026-09-10T08:00:00Z'),
        activity('reschedule-expired', 'reschedule', '2026-09-16', '2026-09-19T08:00:00Z'),
        activity('reschedule-future', 'reschedule', '2026-09-25', '2026-09-19T08:00:00Z'),
      ],
      '2026-09-20',
      'Asia/Kolkata',
    );

    expect(result.map((item) => item.id)).toEqual([
      'cancel-boundary',
      'reschedule-boundary',
      'reschedule-future',
    ]);
  });

  it('excludes cancellation activity with an invalid event timestamp', () => {
    expect(
      filterRetainedAppointmentActivities(
        [activity('invalid', 'cancel', '2026-09-20', 'not-a-date')],
        '2026-09-20',
        'Asia/Kolkata',
      ),
    ).toEqual([]);
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

    expect(result.map((item) => item.id)).toEqual(['today-earlier', 'today-later', 'future-later']);
  });
});
