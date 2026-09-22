import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppointmentsPageContent } from '@/components/pages/AppointmentsPageContent';
import type { AppointmentApiRow } from '@/lib/api/appointments';
import {
  fetchAppointments,
  fetchAvailableAppointmentSlots,
  rescheduleAppointment,
} from '@/lib/api/appointments';
import { getClinicDate } from '@/lib/home-dashboard';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    effectiveRole: 'admin',
  }),
}));

vi.mock('@/components/clinic/ClinicProfileProvider', () => ({
  useClinicProfile: () => ({
    profile: { timezone: 'Asia/Kolkata' },
    status: 'ready',
  }),
}));

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => CLINIC_ID,
}));

vi.mock('@/lib/api/appointments', () => ({
  fetchAppointments: vi.fn(),
  fetchAvailableAppointmentSlots: vi.fn(),
  fetchAppointmentActionRequests: vi.fn().mockResolvedValue([]),
  cancelAppointment: vi.fn(),
  confirmAppointment: vi.fn(),
  createManualAppointment: vi.fn(),
  markAppointmentVisited: vi.fn(),
  rescheduleAppointment: vi.fn(),
  resolveAppointmentActionRequest: vi.fn(),
}));

vi.mock('@/lib/api/clinic-clinical', () => ({
  fetchDoctorServices: vi.fn().mockResolvedValue([]),
  fetchDoctors: vi.fn().mockResolvedValue([]),
  fetchServices: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/api/clinic-settings', () => ({
  fetchClinicSettings: vi.fn().mockResolvedValue({
    allow_doctor_service_edit: false,
  }),
}));

vi.mock('@/components/pages/appointments/PendingAppointments', () => ({
  PendingAppointments: ({
    appointments,
  }: {
    appointments: Array<{ id: string; patientName: string }>;
  }) => (
    <section aria-label="Pending confirmation">
      {appointments.map((appointment) => (
        <p key={appointment.id}>{appointment.patientName}</p>
      ))}
    </section>
  ),
}));

vi.mock('@/components/pages/appointments/VisitedPatients', () => ({
  VisitedPatients: () => <section aria-label="Visited appointments" />,
}));

vi.mock('@/components/pages/appointments/RescheduleCancelRequests', () => ({
  RescheduleCancelRequests: () => <section aria-label="Appointment requests" />,
}));

vi.mock('@/components/pages/appointments/ManualAppointmentModal', () => ({
  ManualAppointmentModal: () => null,
}));

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days))
    .toISOString()
    .slice(0, 10);
}

function appointmentRow(
  id: string,
  patientName: string,
  date: string,
  status = 'pending_confirmation',
  time = '09:00:00',
): AppointmentApiRow {
  return {
    id,
    patient_name: patientName,
    patient_phone: '9876543210',
    doctor_id: '00000000-0000-0000-0000-000000000201',
    doctor_name: 'Doctor',
    clinic_service_id: '00000000-0000-0000-0000-000000000301',
    service_name: 'Consultation',
    appointment_start: `${date} ${time}`,
    appointment_end: `${date} ${time === '09:00:00' ? '09:30:00' : '10:30:00'}`,
    reason_for_visit: 'Checkup',
    visit_type: 'new',
    routing_source: 'voice_bot',
    source: 'agent',
    status,
    has_history: false,
  };
}

const mockedFetchAppointments = vi.mocked(fetchAppointments);
const mockedFetchAvailableAppointmentSlots = vi.mocked(fetchAvailableAppointmentSlots);
const mockedRescheduleAppointment = vi.mocked(rescheduleAppointment);

beforeEach(() => {
  mockedFetchAppointments.mockReset();
  mockedFetchAvailableAppointmentSlots.mockReset();
  mockedRescheduleAppointment.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('AppointmentsPageContent', () => {
  it('shows only current and future appointments in pending confirmation', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([
      appointmentRow('past', 'Past pending patient', shiftDate(clinicToday, -1)),
      appointmentRow('today', 'Today pending patient', clinicToday),
      appointmentRow('future', 'Future pending patient', shiftDate(clinicToday, 1)),
    ]);

    render(<AppointmentsPageContent />);

    expect(await screen.findByText('Today pending patient')).toBeInTheDocument();
    expect(screen.getByText('Future pending patient')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Past pending patient')).not.toBeInTheDocument();
    });
  });

  it('looks up a free slot and saves an edited confirmed appointment time', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments
      .mockResolvedValueOnce([
        appointmentRow('confirmed-1', 'Confirmed patient', clinicToday, 'confirmed'),
      ])
      .mockResolvedValueOnce([
        appointmentRow(
          'confirmed-1',
          'Confirmed patient',
          clinicToday,
          'confirmed',
          '10:00:00',
        ),
      ]);
    mockedFetchAvailableAppointmentSlots.mockResolvedValue([
      {
        slot_id: 'slot-10am',
        doctor_id: '00000000-0000-0000-0000-000000000201',
        clinic_service_id: '00000000-0000-0000-0000-000000000301',
        appointment_start: `${clinicToday} 10:00:00`,
        appointment_end: `${clinicToday} 10:30:00`,
        available_count: 1,
      },
    ]);
    mockedRescheduleAppointment.mockResolvedValue({ appointment: {} });

    render(<AppointmentsPageContent />);

    expect(await screen.findByText('Confirmed patient')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Time' }));
    fireEvent.change(screen.getByDisplayValue('09:00'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedFetchAvailableAppointmentSlots).toHaveBeenCalledWith(CLINIC_ID, {
        doctor_id: '00000000-0000-0000-0000-000000000201',
        clinic_service_id: '00000000-0000-0000-0000-000000000301',
        date: clinicToday,
      });
      expect(mockedRescheduleAppointment).toHaveBeenCalledWith(
        CLINIC_ID,
        'confirmed-1',
        'slot-10am',
      );
    });
    await waitFor(() => {
      expect(screen.queryByDisplayValue('10:00')).not.toBeInTheDocument();
      expect(screen.getByText('10:00 AM')).toBeInTheDocument();
    });
  });

  it('shows a slot-full conflict and keeps the time editor open', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([
      appointmentRow('confirmed-1', 'Confirmed patient', clinicToday, 'confirmed'),
    ]);
    mockedFetchAvailableAppointmentSlots.mockResolvedValue([]);

    render(<AppointmentsPageContent />);

    expect(await screen.findByText('Confirmed patient')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Time' }));
    fireEvent.change(screen.getByDisplayValue('09:00'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Slot is full for that time. Choose another available time.'),
    ).toHaveAttribute('role', 'alert');
    expect(screen.getByDisplayValue('10:00')).toBeInTheDocument();
    expect(mockedRescheduleAppointment).not.toHaveBeenCalled();
  });
});
