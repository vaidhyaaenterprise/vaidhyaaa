import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmedAppointments } from './ConfirmedAppointments';
import { MissedAppointments } from './MissedAppointments';
import { PendingAppointments } from './PendingAppointments';
import type { Appointment, BookingRules } from './types';
import { VisitedPatients } from './VisitedPatients';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    effectiveRole: 'doctor',
    clinicRole: {
      clinic_id: 'clinic-active',
      role: 'doctor',
      doctor_id: 'doctor-active',
      active: true,
    },
    me: {
      clinics: [
        {
          clinic_id: 'clinic-first',
          role: 'doctor',
          doctor_id: 'doctor-first-membership',
          active: true,
        },
      ],
    },
  }),
}));

vi.mock('./AppointmentCard', () => ({
  AppointmentCard: ({ appointment }: { appointment: Appointment }) => (
    <p>{appointment.patientName}</p>
  ),
}));

const bookingRules: BookingRules = {
  slotDurationMinutes: 30,
  capacityPerSlot: 1,
  bookingHorizonDays: 30,
  manualEditCutoffBeforeStartMinutes: 60,
  manualEditMaxShiftMinutes: 60,
  allowDoctorServiceEdit: true,
};

function appointment(id: string, patientName: string, doctorId: string): Appointment {
  return {
    id,
    patientName,
    patientPhone: '9876543210',
    doctorId,
    doctorName: doctorId,
    serviceId: 'service-1',
    serviceName: 'Consultation',
    appointmentDate: '2026-09-23',
    appointmentTime: '09:00',
    reasonForVisit: 'Checkup',
    visitType: 'new',
    routingSource: 'voice_bot',
    source: 'agent',
    status: 'confirmed',
    hasHistory: false,
  };
}

const appointments = [
  appointment('active', 'Active clinic patient', 'doctor-active'),
  appointment('first', 'First membership patient', 'doctor-first-membership'),
];

const noOp = () => undefined;
const noOpAsync = async () => undefined;

const sections: Array<[string, () => ReactElement]> = [
  [
    'pending',
    () => (
      <PendingAppointments
        appointments={appointments}
        bookingRules={bookingRules}
        onConfirm={noOp}
        onEditTime={noOpAsync}
        onCancel={noOp}
        onViewHistory={noOp}
      />
    ),
  ],
  [
    'confirmed',
    () => (
      <ConfirmedAppointments
        appointments={appointments}
        bookingRules={bookingRules}
        onEditTime={noOpAsync}
        onCancel={noOp}
        onMarkVisited={noOpAsync}
        onViewHistory={noOp}
      />
    ),
  ],
  [
    'visited',
    () => (
      <VisitedPatients
        appointments={appointments}
        bookingRules={bookingRules}
        onViewHistory={noOp}
      />
    ),
  ],
  ['missed', () => <MissedAppointments appointments={appointments} />],
];

afterEach(() => {
  cleanup();
});

describe('appointment section clinic scope', () => {
  it.each(sections)('uses the active clinic doctor in the %s section', (_name, renderSection) => {
    render(renderSection());

    expect(screen.getByText('Active clinic patient')).toBeInTheDocument();
    expect(screen.queryByText('First membership patient')).not.toBeInTheDocument();
  });
});
