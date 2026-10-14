import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppointmentCard } from './AppointmentCard';
import type { Appointment } from './types';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ effectiveRole: 'admin', clinicRole: null }),
}));

const appointment: Appointment = {
  id: 'appointment-1',
  patientName: 'Old Patient Name',
  patientPhone: '9876543210',
  doctorId: 'doctor-1',
  doctorName: 'Dr One',
  serviceId: 'service-1',
  serviceName: 'General Consultation',
  appointmentDate: '2026-10-15',
  appointmentTime: '09:30',
  reasonForVisit: 'Fever',
  visitType: 'new',
  routingSource: 'voice_bot',
  source: 'agent',
  status: 'confirmed',
  bookedAt: '2026-10-14T08:00:00.000Z',
  hasHistory: false,
};

afterEach(() => {
  cleanup();
});

describe('AppointmentCard admin actions', () => {
  it('edits only the patient name and omits the timing-policy sentence', async () => {
    const onEditPatientName = vi.fn().mockResolvedValue(undefined);

    render(
      <AppointmentCard
        appointment={appointment}
        onEditPatientName={onEditPatientName}
        onEditTime={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.queryByText(/Edit available within/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit patient name for Old Patient Name' }));
    const nameInput = screen.getByRole('textbox', { name: 'Patient name' });
    fireEvent.change(nameInput, { target: { value: 'New Patient Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => {
      expect(onEditPatientName).toHaveBeenCalledWith('appointment-1', 'New Patient Name');
    });
  });

  it('requires confirmation before cancelling an appointment', async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);

    render(<AppointmentCard appointment={appointment} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(
      screen.getByRole('alertdialog', { name: 'Confirm cancellation for Old Patient Name' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep appointment' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel appointment' }));

    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('appointment-1'));
  });
});
