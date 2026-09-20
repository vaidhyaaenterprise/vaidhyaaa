import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppointmentsPageContent } from '@/components/pages/AppointmentsPageContent';
import type { AppointmentApiRow } from '@/lib/api/appointments';
import { fetchAppointments } from '@/lib/api/appointments';
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
  fetchAppointmentActionRequests: vi.fn().mockResolvedValue([]),
  cancelAppointment: vi.fn(),
  confirmAppointment: vi.fn(),
  createManualAppointment: vi.fn(),
  markAppointmentVisited: vi.fn(),
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

vi.mock('@/components/pages/appointments/ConfirmedAppointments', () => ({
  ConfirmedAppointments: () => <section aria-label="Confirmed appointments" />,
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

function appointmentRow(id: string, patientName: string, date: string): AppointmentApiRow {
  return {
    id,
    patient_name: patientName,
    patient_phone: '9876543210',
    doctor_id: '00000000-0000-0000-0000-000000000201',
    doctor_name: 'Doctor',
    clinic_service_id: '00000000-0000-0000-0000-000000000301',
    service_name: 'Consultation',
    appointment_start: `${date} 09:00:00`,
    appointment_end: `${date} 09:30:00`,
    reason_for_visit: 'Checkup',
    visit_type: 'new',
    routing_source: 'voice_bot',
    source: 'agent',
    status: 'pending_confirmation',
    has_history: false,
  };
}

const mockedFetchAppointments = vi.mocked(fetchAppointments);

beforeEach(() => {
  mockedFetchAppointments.mockReset();
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
});
