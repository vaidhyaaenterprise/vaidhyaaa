import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppointmentsPageContent } from '@/components/pages/AppointmentsPageContent';
import type { AppointmentActivityApiRow, AppointmentApiRow } from '@/lib/api/appointments';
import {
  fetchAppointments,
  fetchAppointmentActivity,
  fetchAvailableAppointmentSlots,
  markAppointmentVisited,
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
  fetchAppointmentActivity: vi.fn().mockResolvedValue([]),
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
  VisitedPatients: ({
    appointments,
  }: {
    appointments: Array<{ id: string; patientName: string }>;
  }) => (
    <section aria-label="Visited appointments">
      {appointments.map((appointment) => (
        <p key={appointment.id}>{appointment.patientName}</p>
      ))}
    </section>
  ),
}));

vi.mock('@/components/pages/appointments/MissedAppointments', () => ({
  MissedAppointments: ({
    appointments,
  }: {
    appointments: Array<{ id: string; patientName: string }>;
  }) => (
    <section aria-label="Missed actions">
      {appointments.map((appointment) => (
        <p key={appointment.id}>{appointment.patientName}</p>
      ))}
    </section>
  ),
}));

vi.mock('@/components/pages/appointments/RescheduleCancelRequests', () => ({
  RescheduleCancelRequests: ({
    activities,
  }: {
    activities: Array<{ id: string; patientName: string }>;
  }) => (
    <section aria-label="Appointment requests">
      {activities.map((activity) => (
        <p key={activity.id}>{activity.patientName}</p>
      ))}
    </section>
  ),
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

function appointmentActivityRow(
  id: string,
  patientName: string,
  actionType: 'reschedule' | 'cancel',
  previousDate: string,
  date: string,
): AppointmentActivityApiRow {
  return {
    id,
    appointment_id: `appointment-${id}`,
    patient_name: patientName,
    patient_phone: '9876543210',
    doctor_id: '00000000-0000-0000-0000-000000000201',
    doctor_name: 'Doctor',
    clinic_service_id: '00000000-0000-0000-0000-000000000301',
    service_name: 'Consultation',
    reason_for_visit: 'Checkup',
    action_type: actionType,
    occurred_at: `${date}T08:00:00.000Z`,
    previous_appointment_start: `${previousDate} 09:00:00`,
    previous_appointment_end: `${previousDate} 09:30:00`,
    appointment_start: `${date} 10:00:00`,
    appointment_end: `${date} 10:30:00`,
  };
}

const mockedFetchAppointments = vi.mocked(fetchAppointments);
const mockedFetchAppointmentActivity = vi.mocked(fetchAppointmentActivity);
const mockedFetchAvailableAppointmentSlots = vi.mocked(fetchAvailableAppointmentSlots);
const mockedMarkAppointmentVisited = vi.mocked(markAppointmentVisited);
const mockedRescheduleAppointment = vi.mocked(rescheduleAppointment);

beforeEach(() => {
  mockedFetchAppointments.mockReset();
  mockedFetchAppointmentActivity.mockReset();
  mockedFetchAppointmentActivity.mockResolvedValue([]);
  mockedFetchAvailableAppointmentSlots.mockReset();
  mockedMarkAppointmentVisited.mockReset();
  mockedRescheduleAppointment.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('AppointmentsPageContent', () => {
  it('separates missed confirmations from current and future pending appointments', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([
      appointmentRow('past', 'Past pending patient', shiftDate(clinicToday, -1)),
      appointmentRow('today', 'Today pending patient', clinicToday),
      appointmentRow('future', 'Future pending patient', shiftDate(clinicToday, 1)),
    ]);

    render(<AppointmentsPageContent />);

    const pending = await screen.findByRole('region', { name: 'Pending confirmation' });
    const missed = screen.getByRole('region', { name: 'Missed actions' });

    expect(within(pending).getByText('Today pending patient')).toBeInTheDocument();
    expect(within(pending).getByText('Future pending patient')).toBeInTheDocument();
    expect(within(pending).queryByText('Past pending patient')).not.toBeInTheDocument();
    expect(within(missed).getByText('Past pending patient')).toBeInTheDocument();
  });

  it('shows only today and future appointments in the confirmed block', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([
      appointmentRow('past', 'Past confirmed patient', shiftDate(clinicToday, -1), 'confirmed'),
      appointmentRow('today', 'Today confirmed patient', clinicToday, 'confirmed'),
      appointmentRow(
        'future',
        'Future confirmed patient',
        shiftDate(clinicToday, 1),
        'confirmed',
      ),
    ]);

    render(<AppointmentsPageContent />);

    expect(await screen.findByText('Today confirmed patient')).toBeInTheDocument();
    expect(screen.getByText('Future confirmed patient')).toBeInTheDocument();
    expect(screen.queryByText('Past confirmed patient')).not.toBeInTheDocument();
  });

  it('marks a confirmed appointment visited, prevents duplicate saves, and refetches it into Visited', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    let resolveMarkVisited:
      | ((value: { appointment: unknown; patient_visit: unknown }) => void)
      | undefined;

    mockedFetchAppointments
      .mockResolvedValueOnce([
        appointmentRow('confirmed-1', 'Visited transition patient', clinicToday, 'confirmed'),
      ])
      .mockResolvedValueOnce([
        appointmentRow('confirmed-1', 'Visited transition patient', clinicToday, 'visited'),
      ]);
    mockedMarkAppointmentVisited.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMarkVisited = resolve;
        }),
    );

    render(<AppointmentsPageContent />);

    expect(await screen.findByText('Visited transition patient')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mark Visited/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Visit reason' }), {
      target: { value: 'Routine consultation completed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Visit' }));

    const savingButton = await screen.findByRole('button', { name: 'Saving Visit…' });
    expect(savingButton).toBeDisabled();
    fireEvent.click(savingButton);
    expect(mockedMarkAppointmentVisited).toHaveBeenCalledTimes(1);
    expect(mockedMarkAppointmentVisited).toHaveBeenCalledWith(CLINIC_ID, 'confirmed-1', {
      visit_reason: 'Routine consultation completed',
    });

    await act(async () => {
      resolveMarkVisited?.({ appointment: {}, patient_visit: {} });
    });

    const visited = screen.getByRole('region', { name: 'Visited appointments' });
    await waitFor(() => {
      expect(mockedFetchAppointments).toHaveBeenCalledTimes(2);
      expect(within(visited).getByText('Visited transition patient')).toBeInTheDocument();
    });
    const confirmed = screen.getByRole('heading', { name: 'Confirmed appointments' }).parentElement;
    expect(confirmed).not.toBeNull();
    expect(within(confirmed as HTMLElement).queryByText('Visited transition patient')).toBeNull();
  });

  it('keeps the mark-visited form open and exposes the API error when saving fails', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([
      appointmentRow('confirmed-1', 'Failed visit patient', clinicToday, 'confirmed'),
    ]);
    mockedMarkAppointmentVisited.mockRejectedValue(new Error('Visit update failed.'));

    render(<AppointmentsPageContent />);

    expect(await screen.findByText('Failed visit patient')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mark Visited/i }));
    const visitReason = screen.getByRole('textbox', { name: 'Visit reason' });
    fireEvent.change(visitReason, { target: { value: 'Consultation completed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Visit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Visit update failed.');
    expect(visitReason).toHaveValue('Consultation completed');
    expect(visitReason).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save Visit' })).toBeEnabled();
    expect(mockedFetchAppointments).toHaveBeenCalledTimes(1);
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

  it('looks up availability on the edited date before rescheduling', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    const newDate = shiftDate(clinicToday, 2);
    mockedFetchAppointments
      .mockResolvedValueOnce([
        appointmentRow('confirmed-1', 'Cross-date patient', clinicToday, 'confirmed'),
      ])
      .mockResolvedValueOnce([
        appointmentRow('confirmed-1', 'Cross-date patient', newDate, 'confirmed', '10:00:00'),
      ]);
    mockedFetchAvailableAppointmentSlots.mockResolvedValue([
      {
        slot_id: 'future-slot-10am',
        doctor_id: '00000000-0000-0000-0000-000000000201',
        clinic_service_id: '00000000-0000-0000-0000-000000000301',
        appointment_start: `${newDate} 10:00:00`,
        appointment_end: `${newDate} 10:30:00`,
        available_count: 1,
      },
    ]);
    mockedRescheduleAppointment.mockResolvedValue({ appointment: {} });

    render(<AppointmentsPageContent />);

    expect(await screen.findByText('Cross-date patient')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Time' }));
    fireEvent.change(screen.getByLabelText('Appointment date'), {
      target: { value: newDate },
    });
    fireEvent.change(screen.getByLabelText('Appointment time'), {
      target: { value: '10:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedFetchAvailableAppointmentSlots).toHaveBeenCalledWith(CLINIC_ID, {
        doctor_id: '00000000-0000-0000-0000-000000000201',
        clinic_service_id: '00000000-0000-0000-0000-000000000301',
        date: newDate,
      });
      expect(mockedRescheduleAppointment).toHaveBeenCalledWith(
        CLINIC_ID,
        'confirmed-1',
        'future-slot-10am',
      );
    });
  });

  it('maps completed appointment activity into the requests block', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([]);
    mockedFetchAppointmentActivity.mockResolvedValue([
      appointmentActivityRow(
        'activity-1',
        'Rescheduled activity patient',
        'reschedule',
        clinicToday,
        shiftDate(clinicToday, 1),
      ),
    ]);

    render(<AppointmentsPageContent />);

    const activityBlock = await screen.findByRole('region', { name: 'Appointment requests' });
    expect(within(activityBlock).getByText('Rescheduled activity patient')).toBeInTheDocument();
  });
});
