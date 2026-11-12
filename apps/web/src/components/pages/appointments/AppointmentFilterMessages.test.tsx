import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmedAppointments } from './ConfirmedAppointments';
import { MissedAppointments } from './MissedAppointments';
import { RescheduleCancelRequests } from './RescheduleCancelRequests';
import { VisitedPatients } from './VisitedPatients';
import type { Appointment } from './types';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ effectiveRole: 'admin' }),
}));
vi.mock('./AppointmentCard', () => ({
  AppointmentCard: ({ appointment }: { appointment: Appointment }) => (
    <p>{appointment.patientName}</p>
  ),
}));
afterEach(cleanup);

const noOp = vi.fn();
const dateLabel = '28/10/2026';
const appointment: Appointment = {
  id: 'appointment-1',
  patientName: 'Patient',
  patientPhone: '9876543210',
  doctorId: 'doctor-1',
  doctorName: 'Doctor',
  serviceId: 'service-1',
  serviceName: 'Consultation',
  appointmentDate: '2026-10-28',
  appointmentTime: '09:00',
  reasonForVisit: 'Review',
  visitType: 'new',
  routingSource: 'voice_bot',
  source: 'agent',
  status: 'confirmed',
  bookedAt: '2026-10-24T08:00:00Z',
  hasHistory: false,
};

describe('Appointment date-filter messages', () => {
  it.each([false, true])(
    'uses date-specific confirmed and visited descriptions (has appointments: %s)',
    (hasAppointments) => {
      const appointments = hasAppointments ? [appointment] : [];
      render(
        <>
          <ConfirmedAppointments
            appointments={appointments}
            dateLabel={dateLabel}
            onEditTime={noOp}
            onCancel={noOp}
            onEditPatientName={noOp}
            onMarkVisited={noOp}
            onViewHistory={noOp}
          />
          <VisitedPatients
            appointments={appointments}
            dateLabel={dateLabel}
            onViewHistory={noOp}
            onEditPatientName={noOp}
          />
        </>,
      );
      expect(screen.getByText(`Confirmed appointments for ${dateLabel}.`)).toBeInTheDocument();
      expect(
        screen.getByText(
          `Patients with appointments on ${dateLabel} who completed their consultation.`,
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Today and upcoming confirmed appointments.'),
      ).not.toBeInTheDocument();
      if (!hasAppointments) {
        expect(screen.getByText(`No confirmed appointments for ${dateLabel}.`)).toBeInTheDocument();
        expect(screen.getByText(`No visited patients for ${dateLabel}.`)).toBeInTheDocument();
      }
    },
  );

  it('uses date-specific missed-actions and reschedule/cancel empty states', () => {
    const { rerender } = render(
      <>
        <MissedAppointments appointments={[]} dateLabel={dateLabel} onEditPatientName={noOp} />
        <RescheduleCancelRequests
          requests={[]}
          activities={[]}
          dateLabel={dateLabel}
          onApproveReschedule={noOp}
          onRejectRequest={noOp}
          onCancelAppointment={noOp}
          onEditPatientName={noOp}
        />
      </>,
    );
    expect(
      screen.getByText(`Appointments for ${dateLabel} where no clinic-admin action was taken.`),
    ).toBeInTheDocument();
    expect(screen.getByText(`No missed actions for ${dateLabel}.`)).toBeInTheDocument();
    expect(
      screen.getByText(`No pending requests or recent changes for appointments on ${dateLabel}.`),
    ).toBeInTheDocument();
    rerender(
      <>
        <MissedAppointments appointments={[]} onEditPatientName={noOp} />
        <RescheduleCancelRequests
          requests={[]}
          activities={[]}
          onApproveReschedule={noOp}
          onRejectRequest={noOp}
          onCancelAppointment={noOp}
          onEditPatientName={noOp}
        />
      </>,
    );
    expect(screen.getByText('No missed actions')).toBeInTheDocument();
    expect(screen.getByText('No pending requests or recent changes')).toBeInTheDocument();
    expect(screen.queryByText(/28\/10\/2026/)).not.toBeInTheDocument();
  });
});
