import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmedAppointments } from './ConfirmedAppointments';
import { MissedAppointments } from './MissedAppointments';
import { PendingAppointments } from './PendingAppointments';
import type { Appointment } from './types';
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

function appointment(id: string, patientName: string, doctorId: string): Appointment {
  return {
    id,
    patientName,
    patientPhone: '9876543210',
    doctorId,
    doctorName: doctorId,
    serviceId: 'service-1',
    serviceName: 'Consultation',
    bookedAt: '2026-09-23T03:30:00.000Z',
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
        onConfirm={noOp}
        onEditTime={noOpAsync}
        onCancel={noOpAsync}
        onEditPatientName={noOpAsync}
        onViewHistory={noOp}
      />
    ),
  ],
  [
    'confirmed',
    () => (
      <ConfirmedAppointments
        appointments={appointments}
        onEditTime={noOpAsync}
        onCancel={noOpAsync}
        onEditPatientName={noOpAsync}
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
        onViewHistory={noOp}
        onEditPatientName={noOpAsync}
      />
    ),
  ],
  [
    'missed',
    () => (
      <MissedAppointments appointments={appointments} onEditPatientName={noOpAsync} />
    ),
  ],
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
