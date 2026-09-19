import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HomePageContent } from '@/components/pages/HomePageContent';
import {
  cancelAppointment,
  confirmAppointment,
  fetchAppointments,
  type AppointmentApiRow,
} from '@/lib/api/appointments';
import { fetchClinicProfile, fetchClinicSettings } from '@/lib/api/clinic-settings';
import { getClinicDate } from '@/lib/home-dashboard';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';

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
  confirmAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
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
    doctor_id: '00000000-0000-0000-0000-000000000201',
    doctor_name: 'Dr. Test',
    clinic_service_id: '00000000-0000-0000-0000-000000000301',
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
const mockedConfirmAppointment = vi.mocked(confirmAppointment);
const mockedCancelAppointment = vi.mocked(cancelAppointment);
const mockedFetchClinicSettings = vi.mocked(fetchClinicSettings);
const mockedFetchClinicProfile = vi.mocked(fetchClinicProfile);

beforeEach(() => {
  mockedFetchAppointments.mockReset().mockResolvedValue([]);
  mockedConfirmAppointment.mockReset().mockResolvedValue({ appointment: {} });
  mockedCancelAppointment.mockReset().mockResolvedValue({ appointment: {} });
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
    expect(
      within(missedActions).getByRole('button', {
        name: 'Confirm appointment for Past Pending',
      }),
    ).toBeInTheDocument();
    expect(
      within(missedActions).getByRole('button', {
        name: 'Cancel appointment for Past Pending',
      }),
    ).toBeInTheDocument();

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

  it('keeps missed requests actionable and refreshes the dashboard after confirmation', async () => {
    const today = getClinicDate(new Date(), 'Asia/Kolkata');
    const missed = appointmentRow(
      'missed-pending',
      'Missed Patient',
      shiftDate(today, -1),
      '09:00',
      'pending_confirmation',
    );
    mockedFetchAppointments.mockResolvedValueOnce([missed]).mockResolvedValueOnce([]);

    render(<HomePageContent />);

    const missedActions = await screen.findByRole('region', { name: 'Missed actions' });
    const confirmButton = within(missedActions).getByRole('button', {
      name: 'Confirm appointment for Missed Patient',
    });
    const cancelButton = within(missedActions).getByRole('button', {
      name: 'Cancel appointment for Missed Patient',
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(confirmButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();

    await waitFor(() => {
      expect(mockedConfirmAppointment).toHaveBeenCalledWith(CLINIC_ID, 'missed-pending');
    });
    await waitFor(() => {
      expect(within(missedActions).queryByText('Missed Patient')).not.toBeInTheDocument();
    });
    expect(mockedConfirmAppointment).toHaveBeenCalledTimes(1);
    expect(mockedCancelAppointment).not.toHaveBeenCalled();
    expect(mockedFetchAppointments).toHaveBeenCalledTimes(2);
  });

  it('ignores an older dashboard reload that finishes after a newer action reload', async () => {
    const today = getClinicDate(new Date(), 'Asia/Kolkata');
    const rows = [
      appointmentRow(
        'missed-a',
        'Missed Patient A',
        shiftDate(today, -1),
        '09:00',
        'pending_confirmation',
      ),
      appointmentRow(
        'missed-b',
        'Missed Patient B',
        shiftDate(today, -1),
        '10:00',
        'pending_confirmation',
      ),
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

    const missedActions = await screen.findByRole('region', { name: 'Missed actions' });
    fireEvent.click(
      within(missedActions).getByRole('button', {
        name: 'Confirm appointment for Missed Patient A',
      }),
    );
    await waitFor(() => expect(mockedFetchAppointments).toHaveBeenCalledTimes(2));

    fireEvent.click(
      within(missedActions).getByRole('button', {
        name: 'Confirm appointment for Missed Patient B',
      }),
    );
    await waitFor(() => expect(mockedFetchAppointments).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByText('Missed Patient B')).not.toBeInTheDocument());

    await act(async () => {
      resolveOlderReload(rows);
      await olderReload;
    });

    expect(screen.queryByText('Missed Patient A')).not.toBeInTheDocument();
    expect(screen.queryByText('Missed Patient B')).not.toBeInTheDocument();
    expect(mockedConfirmAppointment).toHaveBeenCalledTimes(2);
  });
});
