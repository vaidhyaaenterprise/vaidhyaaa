import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RescheduleCancelRequests } from './RescheduleCancelRequests';
import type { AppointmentActionRequest, AppointmentActivity } from './types';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ effectiveRole: 'admin' }),
}));

afterEach(() => {
  cleanup();
});

const request: AppointmentActionRequest = {
  id: 'request-1',
  appointmentId: 'appointment-1',
  patientName: 'Request patient',
  doctorId: 'doctor-1',
  doctorName: 'Doctor',
  serviceId: 'service-1',
  serviceName: 'Consultation',
  requestedDate: '2026-09-25',
  requestedTime: '10:00',
  requestedNewSlotId: 'slot-1',
  reason: 'Patient requested a change',
  actionType: 'cancel',
  status: 'pending',
};

const semanticTimeRescheduleRequest: AppointmentActionRequest = {
  ...request,
  id: 'request-reschedule-1',
  actionType: 'reschedule',
  requestedDate: '2026-09-26',
  requestedTime: 'morning',
  requestedNewSlotId: 'slot-morning',
};

const activity: AppointmentActivity = {
  id: 'activity-1',
  appointmentId: 'appointment-2',
  patientName: 'Activity patient',
  patientPhone: '9876543210',
  doctorId: 'doctor-1',
  doctorName: 'Doctor',
  serviceId: 'service-1',
  serviceName: 'Consultation',
  reasonForVisit: 'Review',
  actionType: 'reschedule',
  occurredAt: '2026-09-23T08:00:00.000Z',
  previousAppointmentDate: '2026-09-24',
  previousAppointmentTime: '09:00',
  appointmentDate: '2026-09-25',
  appointmentTime: '10:00',
};

describe('RescheduleCancelRequests', () => {
  it('uses safe controls for a pending cancellation request', async () => {
    const onCancelAppointment = vi.fn().mockResolvedValue(undefined);
    const onRejectRequest = vi.fn().mockResolvedValue(undefined);

    render(
      <RescheduleCancelRequests
        requests={[request]}
        activities={[]}
        onApproveReschedule={vi.fn().mockResolvedValue(undefined)}
        onRejectRequest={onRejectRequest}
        onCancelAppointment={onCancelAppointment}
      />,
    );

    expect(screen.getByRole('button', { name: 'Approve cancellation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reject request' }));
    await waitFor(() => expect(onRejectRequest).toHaveBeenCalledWith('request-1'));
    expect(onCancelAppointment).not.toHaveBeenCalled();
  });

  it('renders completed activity as read-only appointment history', () => {
    render(
      <RescheduleCancelRequests
        requests={[]}
        activities={[activity]}
        onApproveReschedule={vi.fn().mockResolvedValue(undefined)}
        onRejectRequest={vi.fn().mockResolvedValue(undefined)}
        onCancelAppointment={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const history = screen.getByRole('region', { name: 'Recent changes' });
    expect(within(history).getByText('Activity patient')).toBeInTheDocument();
    expect(within(history).getByText('Rescheduled')).toBeInTheDocument();
    expect(within(history).queryByRole('button')).not.toBeInTheDocument();
  });

  it('approves a held requested slot without binding a semantic preference to the time input', async () => {
    const onApproveReschedule = vi.fn().mockResolvedValue(undefined);

    render(
      <RescheduleCancelRequests
        requests={[semanticTimeRescheduleRequest]}
        activities={[]}
        onApproveReschedule={onApproveReschedule}
        onRejectRequest={vi.fn().mockResolvedValue(undefined)}
        onCancelAppointment={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose another slot' }));
    expect(screen.getByLabelText('New time')).toHaveValue('');
    expect(screen.getByText('Requested preference: morning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save reschedule' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve requested slot' }));

    await waitFor(() =>
      expect(onApproveReschedule).toHaveBeenCalledWith(
        'request-reschedule-1',
        '2026-09-26',
        'morning',
      ),
    );
  });
});
