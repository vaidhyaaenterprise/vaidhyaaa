import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HomePageContent } from '@/components/pages/HomePageContent';
import {
  cancelAppointment,
  confirmAppointment,
  createManualAppointment,
  fetchAvailableAppointmentSlots,
  fetchAppointments,
  type AppointmentApiRow,
} from '@/lib/api/appointments';
import {
  fetchDoctorServices,
  fetchDoctors,
  fetchHolidays,
  fetchServices,
  searchPatientHistory,
} from '@/lib/api/clinic-clinical';
import { fetchClinicProfile, fetchClinicSettings } from '@/lib/api/clinic-settings';
import { getClinicDate } from '@/lib/home-dashboard';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const DOCTOR_ID = '00000000-0000-0000-0000-000000000201';
const SERVICE_ID = '00000000-0000-0000-0000-000000000301';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    me: {
      user: {
        id: '00000000-0000-0000-0000-000000000102',
        name: 'Clinic Admin',
        email: 'admin@sri-murugan.local',
        phone: null,
        platform_role: null,
        active: true,
      },
      clinics: [
        {
          clinic_id: CLINIC_ID,
          role: 'clinic_admin',
          doctor_id: null,
          active: true,
        },
      ],
    },
    effectiveRole: 'admin',
    clinicRole: {
      clinic_id: CLINIC_ID,
      role: 'clinic_admin',
      doctor_id: null,
      active: true,
    },
    error: null,
    errorCode: null,
    refresh: async () => {},
  }),
}));

vi.mock('@/lib/api/appointments', () => ({
  fetchAppointments: vi.fn(),
  fetchAvailableAppointmentSlots: vi.fn(),
  confirmAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
  createManualAppointment: vi.fn(),
}));

vi.mock('@/lib/api/clinic-clinical', () => ({
  fetchDoctorServices: vi.fn(),
  fetchDoctors: vi.fn(),
  fetchHolidays: vi.fn(),
  fetchServices: vi.fn(),
  searchPatientHistory: vi.fn(),
}));

vi.mock('@/lib/api/clinic-settings', () => ({
  fetchClinicSettings: vi.fn(),
  fetchClinicProfile: vi.fn(),
}));

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return shifted.toISOString().slice(0, 10);
}

function appointmentRow(
  id: string,
  patientName: string,
  date: string,
  time: string,
  status: string,
): AppointmentApiRow {
  return {
    id,
    patient_name: patientName,
    patient_phone: '+919876543210',
    doctor_id: DOCTOR_ID,
    doctor_name: 'Dr. Test',
    clinic_service_id: SERVICE_ID,
    service_name: 'General Consultation',
    appointment_start: `${date} ${time}:00`,
    appointment_end: `${date} ${time}:00`,
    reason_for_visit: 'Checkup',
    visit_type: 'new',
    routing_source: 'manual_booking',
    source: 'manual',
    status,
    has_history: false,
  };
}

const mockedFetchAppointments = vi.mocked(fetchAppointments);
const mockedFetchAvailableAppointmentSlots = vi.mocked(fetchAvailableAppointmentSlots);
const mockedConfirmAppointment = vi.mocked(confirmAppointment);
const mockedCancelAppointment = vi.mocked(cancelAppointment);
const mockedCreateManualAppointment = vi.mocked(createManualAppointment);
const mockedFetchDoctorServices = vi.mocked(fetchDoctorServices);
const mockedFetchDoctors = vi.mocked(fetchDoctors);
const mockedFetchHolidays = vi.mocked(fetchHolidays);
const mockedFetchServices = vi.mocked(fetchServices);
const mockedSearchPatientHistory = vi.mocked(searchPatientHistory);
const mockedFetchClinicSettings = vi.mocked(fetchClinicSettings);
const mockedFetchClinicProfile = vi.mocked(fetchClinicProfile);

beforeEach(() => {
  mockedFetchAppointments.mockReset().mockResolvedValue([]);
  mockedFetchAvailableAppointmentSlots.mockReset().mockResolvedValue([]);
  mockedConfirmAppointment.mockReset().mockResolvedValue({ appointment: {} });
  mockedCancelAppointment.mockReset().mockResolvedValue({ appointment: {} });
  mockedCreateManualAppointment.mockReset().mockResolvedValue({});
  mockedFetchDoctors.mockReset().mockResolvedValue([
    {
      id: DOCTOR_ID,
      name: 'Dr. Test',
      qualification: 'MD',
      user_id: null,
      active: true,
    },
  ]);
  mockedFetchServices.mockReset().mockResolvedValue([
    {
      id: SERVICE_ID,
      service_name: 'General Consultation',
      service_key: 'general_consultation',
      active: true,
    },
  ]);
  mockedFetchDoctorServices.mockReset().mockResolvedValue([
    {
      id: '00000000-0000-0000-0000-000000000401',
      doctor_id: DOCTOR_ID,
      clinic_service_id: SERVICE_ID,
      consultation_fee_amount: '500.00',
      active: true,
    },
  ]);
  mockedFetchHolidays.mockReset().mockResolvedValue([]);
  mockedSearchPatientHistory.mockReset().mockResolvedValue([]);
  mockedFetchClinicSettings.mockReset().mockRejectedValue(new Error('Settings unavailable'));
  mockedFetchClinicProfile.mockReset().mockResolvedValue({
    name: 'Test Clinic',
    clinic_unique_number: 100001,
    primary_phone: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: 'India',
    timezone: 'Asia/Kolkata',
  });
});

afterEach(() => {
  cleanup();
});

describe('HomePage dashboard', () => {
  it('renders the portal home heading and agent toggle for admin', async () => {
    render(<HomePageContent />);

    expect(screen.getByRole('heading', { name: /^home$/i })).toBeInTheDocument();
    expect(screen.getByLabelText('AI Voice Agent status')).toBeInTheDocument();
    expect(await screen.findByText('Vaidya dashboard for Clinic Admin')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Missed actions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Today's summary" })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Session' })).not.toBeInTheDocument();
  });

  it('opens the shared manual-booking modal and creates a slot-backed appointment', async () => {
    const today = new Date();
    const todayDate = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
    const appointmentStart = `${todayDate}T09:00:00Z`;
    const appointmentEnd = `${todayDate}T09:30:00Z`;
    let resolveCreateAppointment: (value: unknown) => void = () => {};
    const createAppointmentRequest = new Promise<unknown>((resolve) => {
      resolveCreateAppointment = resolve;
    });
    mockedCreateManualAppointment.mockReturnValue(createAppointmentRequest);
    mockedFetchAvailableAppointmentSlots.mockResolvedValue([
      {
        slot_id: '00000000-0000-0000-0000-000000000501',
        doctor_id: DOCTOR_ID,
        clinic_service_id: SERVICE_ID,
        appointment_start: appointmentStart,
        appointment_end: appointmentEnd,
        available_count: 1,
      },
    ]);
    mockedFetchAppointments.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    render(<HomePageContent />);

    await screen.findByText('Vaidya dashboard for Clinic Admin');
    const manualBookingButton = screen.getByRole('button', { name: 'Add manual booking' });
    expect(manualBookingButton).toBeEnabled();
    fireEvent.click(manualBookingButton);

    const dialog = await screen.findByRole('dialog', { name: 'New manual appointment' });
    fireEvent.change(within(dialog).getByPlaceholderText('Enter patient name'), {
      target: { value: 'New Patient' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('+91 98765 43210'), {
      target: { value: '9876543210' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. 38'), {
      target: { value: '38' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('Describe the reason for visit'), {
      target: { value: 'Routine checkup' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Select date/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Today' }));

    await waitFor(() => {
      expect(mockedFetchAvailableAppointmentSlots).toHaveBeenCalledWith(CLINIC_ID, {
        doctor_id: DOCTOR_ID,
        clinic_service_id: SERVICE_ID,
        date: todayDate,
      });
    });

    const createButton = within(dialog).getByRole('button', { name: 'Create appointment' });
    await waitFor(() => expect(createButton).toBeEnabled());
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(mockedCreateManualAppointment).toHaveBeenCalledWith(CLINIC_ID, {
        patient_name: 'New Patient',
        patient_phone: '9876543210',
        patient_age: 38,
        slot_id: '00000000-0000-0000-0000-000000000501',
        doctor_id: DOCTOR_ID,
        clinic_service_id: SERVICE_ID,
        reason_for_visit: 'Routine checkup',
        appointment_start: appointmentStart,
        appointment_end: appointmentEnd,
        is_followup: false,
        status: 'confirmed',
      });
    });
    expect(within(dialog).getByRole('button', { name: 'Creating appointment…' })).toBeDisabled();
    expect(dialog).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Creating appointment…' }));
    expect(mockedCreateManualAppointment).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreateAppointment({});
      await createAppointmentRequest;
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'New manual appointment' }),
      ).not.toBeInTheDocument();
    });
    expect(mockedFetchAppointments).toHaveBeenCalledTimes(2);
  });

  it('shows only clinic-today data in current cards and moves older pending requests to missed actions', async () => {
    const today = getClinicDate(new Date(), 'Asia/Kolkata');
    const yesterday = shiftDate(today, -1);
    const tomorrow = shiftDate(today, 1);
    mockedFetchAppointments.mockResolvedValue([
      appointmentRow('today-pending', 'Today Pending', today, '09:30', 'pending_confirmation'),
      appointmentRow('today-confirmed', 'Today Confirmed', today, '10:00', 'confirmed'),
      appointmentRow('past-pending', 'Past Pending', yesterday, '11:00', 'pending_confirmation'),
      appointmentRow('past-confirmed', 'Past Confirmed', yesterday, '12:00', 'confirmed'),
      appointmentRow('future-pending', 'Future Pending', tomorrow, '09:00', 'pending_confirmation'),
      appointmentRow('today-cancelled', 'Today Cancelled', today, '08:00', 'cancelled'),
    ]);

    render(<HomePageContent />);

    const needsAction = await screen.findByRole('region', { name: 'Needs your action' });
    const todaySummary = screen.getByRole('region', { name: "Today's summary" });
    const missedActions = screen.getByRole('region', { name: 'Missed actions' });
    const nextAppointments = screen.getByRole('region', { name: 'Next appointments' });

    expect(within(needsAction).getByText('Today Pending')).toBeInTheDocument();
    expect(within(needsAction).queryByText('Past Pending')).not.toBeInTheDocument();

    expect(within(missedActions).getByText('Past Pending')).toBeInTheDocument();
    expect(within(missedActions).getByRole('list')).toBeInTheDocument();
    expect(within(missedActions).getByText('General Consultation — Checkup')).toBeInTheDocument();
    expect(within(missedActions).getByText('No action taken')).toBeInTheDocument();
    expect(
      within(missedActions).queryByRole('button', {
        name: 'Confirm appointment for Past Pending',
      }),
    ).not.toBeInTheDocument();
    expect(
      within(missedActions).queryByRole('button', {
        name: 'Cancel appointment for Past Pending',
      }),
    ).not.toBeInTheDocument();

    expect(within(nextAppointments).getByText('Today Pending')).toBeInTheDocument();
    expect(within(nextAppointments).getByText('Today Confirmed')).toBeInTheDocument();
    expect(within(nextAppointments).queryByText('Past Pending')).not.toBeInTheDocument();
    expect(within(nextAppointments).queryByText('Past Confirmed')).not.toBeInTheDocument();
    expect(screen.queryByText('Future Pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Today Cancelled')).not.toBeInTheDocument();
    expect(within(todaySummary).getByText('Total calls')).toBeInTheDocument();
    expect(within(todaySummary).getByText('0')).toBeInTheDocument();
    expect(within(todaySummary).getByText('Pending confirmations')).toBeInTheDocument();
    expect(within(todaySummary).getByText('1')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Session' })).not.toBeInTheDocument();

    const topCardGrid = needsAction.parentElement;
    expect(topCardGrid?.children[0]).toBe(needsAction);
    expect(topCardGrid?.children[1]).toBe(todaySummary);
    expect(topCardGrid?.children[2]).toBe(nextAppointments);
    expect(missedActions.parentElement).not.toBe(topCardGrid);

    expect(mockedFetchAppointments).toHaveBeenCalledWith(CLINIC_ID, [
      'pending_confirmation',
      'confirmed',
    ]);
  });

  it('does not classify appointments when the clinic timezone cannot be loaded', async () => {
    const today = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([
      appointmentRow(
        'unclassified',
        'Must Not Be Classified',
        today,
        '09:30',
        'pending_confirmation',
      ),
    ]);
    mockedFetchClinicProfile.mockRejectedValue(new Error('Profile unavailable'));

    render(<HomePageContent />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load dashboard data.');
    expect(screen.queryByText('Must Not Be Classified')).not.toBeInTheDocument();
  });

  it('shows missed requests as read-only history and excludes them from pending staff actions', async () => {
    const today = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([
      appointmentRow(
        'missed-pending',
        'Missed Patient',
        shiftDate(today, -1),
        '09:00',
        'pending_confirmation',
      ),
    ]);

    render(<HomePageContent />);

    const missedActions = await screen.findByRole('region', { name: 'Missed actions' });
    expect(within(missedActions).getByText('Missed Patient')).toBeInTheDocument();
    expect(within(missedActions).getByText('No action taken')).toBeInTheDocument();
    expect(within(missedActions).queryAllByRole('button')).toHaveLength(0);

    const pendingActionsCounter = screen.getByText('pending staff actions').parentElement;
    expect(pendingActionsCounter).not.toBeNull();
    expect(within(pendingActionsCounter as HTMLElement).getByText('0')).toBeInTheDocument();
    expect(screen.getByText(/1 missed request is listed below\./)).toBeInTheDocument();
    expect(mockedConfirmAppointment).not.toHaveBeenCalled();
    expect(mockedCancelAppointment).not.toHaveBeenCalled();
    expect(mockedFetchAppointments).toHaveBeenCalledTimes(1);
  });

  it('keeps current-day requests actionable and prevents duplicate confirmation', async () => {
    const today = getClinicDate(new Date(), 'Asia/Kolkata');
    const current = appointmentRow(
      'today-pending',
      'Today Patient',
      today,
      '09:00',
      'pending_confirmation',
    );
    mockedFetchAppointments.mockResolvedValueOnce([current]).mockResolvedValueOnce([]);

    render(<HomePageContent />);

    const needsAction = await screen.findByRole('region', { name: 'Needs your action' });
    const confirmButton = within(needsAction).getByRole('button', {
      name: 'Confirm appointment for Today Patient',
    });
    const cancelButton = within(needsAction).getByRole('button', {
      name: 'Cancel appointment for Today Patient',
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(confirmButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();

    await waitFor(() => {
      expect(mockedConfirmAppointment).toHaveBeenCalledWith(CLINIC_ID, 'today-pending');
    });
    await waitFor(() => {
      expect(within(needsAction).queryByText('Today Patient')).not.toBeInTheDocument();
    });
    expect(mockedConfirmAppointment).toHaveBeenCalledTimes(1);
    expect(mockedCancelAppointment).not.toHaveBeenCalled();
    expect(mockedFetchAppointments).toHaveBeenCalledTimes(2);
  });

  it('ignores an older dashboard reload that finishes after a newer action reload', async () => {
    const today = getClinicDate(new Date(), 'Asia/Kolkata');
    const rows = [
      appointmentRow('today-a', 'Today Patient A', today, '09:00', 'pending_confirmation'),
      appointmentRow('today-b', 'Today Patient B', today, '10:00', 'pending_confirmation'),
    ];
    let resolveOlderReload: (appointments: AppointmentApiRow[]) => void = () => {};
    const olderReload = new Promise<AppointmentApiRow[]>((resolve) => {
      resolveOlderReload = resolve;
    });
    mockedFetchAppointments
      .mockResolvedValueOnce(rows)
      .mockReturnValueOnce(olderReload)
      .mockResolvedValueOnce([]);

    render(<HomePageContent />);

    const needsAction = await screen.findByRole('region', { name: 'Needs your action' });
    fireEvent.click(
      within(needsAction).getByRole('button', {
        name: 'Confirm appointment for Today Patient A',
      }),
    );
    await waitFor(() => expect(mockedFetchAppointments).toHaveBeenCalledTimes(2));

    fireEvent.click(
      within(needsAction).getByRole('button', {
        name: 'Confirm appointment for Today Patient B',
      }),
    );
    await waitFor(() => expect(mockedFetchAppointments).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByText('Today Patient B')).not.toBeInTheDocument());

    await act(async () => {
      resolveOlderReload(rows);
      await olderReload;
    });

    expect(screen.queryByText('Today Patient A')).not.toBeInTheDocument();
    expect(screen.queryByText('Today Patient B')).not.toBeInTheDocument();
    expect(mockedConfirmAppointment).toHaveBeenCalledTimes(2);
  });
});
