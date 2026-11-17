import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DoctorSettings } from './DoctorSettings';
import { BookingRules } from '@/components/pages/clinic-setup/BookingRules';
import { DoctorSchedule } from '@/components/pages/clinic-setup/DoctorSchedule';
import { HolidaySetup } from '@/components/pages/clinic-setup/HolidaySetup';
import { ApiRequestError } from '@/lib/api/client';
import {
  createHoliday,
  fetchAllDoctorSchedules,
  fetchBookingRules,
  fetchDoctors,
  fetchDoctorSchedules,
  fetchHolidays,
  patchBookingRule,
  patchHoliday,
  replaceAllDoctorSchedules,
  replaceDoctorSchedules,
  type BookingRuleApiRow,
  type HolidayApiRow,
} from '@/lib/api/clinic-clinical';
import { fetchClinicSettings, patchClinicSettings } from '@/lib/api/clinic-settings';
import { previewBookingRuleChange } from '@/lib/api/clinic-subscription';

const clinicId = '00000000-0000-0000-0000-000000000001';
const doctorId = '00000000-0000-0000-0000-000000000101';
const otherDoctorId = '00000000-0000-0000-0000-000000000102';
let membershipDoctorId: string | null = doctorId;

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    effectiveRole: 'doctor',
    me: {
      clinics: [
        { clinic_id: clinicId, role: 'doctor', active: true, doctor_id: membershipDoctorId },
      ],
    },
  }),
}));
vi.mock('@/hooks/useActiveClinicId', () => ({ useActiveClinicId: () => clinicId }));
vi.mock('@/components/clinic/ClinicProfileProvider', () => ({
  useClinicProfile: () => ({ profile: { timezone: 'Asia/Kolkata' }, status: 'ready' }),
}));
vi.mock('@/lib/api/clinic-clinical', () => ({
  createHoliday: vi.fn(),
  fetchDoctors: vi.fn(),
  fetchHolidays: vi.fn(),
  patchHoliday: vi.fn(),
  fetchBookingRules: vi.fn(),
  patchBookingRule: vi.fn(),
  fetchAllDoctorSchedules: vi.fn(),
  fetchDoctorSchedules: vi.fn(),
  replaceDoctorSchedules: vi.fn(),
  replaceAllDoctorSchedules: vi.fn(),
}));
vi.mock('@/lib/api/clinic-settings', () => ({
  fetchClinicSettings: vi.fn(),
  patchClinicSettings: vi.fn(),
}));
vi.mock('@/lib/api/clinic-subscription', () => ({ previewBookingRuleChange: vi.fn() }));
vi.mock('@/components/pages/clinic-setup/SlotUpdateStatus', () => ({
  SlotUpdateStatus: () => null,
}));

const rule: BookingRuleApiRow = {
  id: 'self-rule',
  doctor_id: doctorId,
  clinic_service_id: 'service-1',
  slot_duration_minutes: 15,
  capacity_per_slot: 1,
  booking_horizon_days: 45,
  active: true,
};
function holiday(id: string, doctorIds: string[]): HolidayApiRow {
  return {
    id,
    holiday_date: '2026-12-20',
    reason: id,
    is_full_day: true,
    active: true,
    doctor_ids: doctorIds,
    applies_to_clinic: doctorIds.length === 0,
  };
}
const appointmentConflict = {
  appointment_id: '00000000-0000-0000-0000-000000000201',
  appointment: {
    patient_name: 'Asha Patient',
    appointment_start: '2026-12-20 09:30:00',
    appointment_end: '2026-12-20 09:45:00',
    doctor_name: 'Dr. Self',
    service_name: 'General consultation',
    status: 'confirmed' as const,
  },
  reason: 'outside_doctor_hours',
};
function conflictError() {
  return new ApiRequestError({
    code: 'CONFLICTING_APPOINTMENTS',
    message: 'Appointments conflict.',
    details: { conflicts: [appointmentConflict] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
  membershipDoctorId = doctorId;
  vi.mocked(fetchDoctors).mockResolvedValue([
    { id: doctorId, name: 'Dr. Self', qualification: 'MD', active: true, user_id: null },
    { id: otherDoctorId, name: 'Dr. Other', qualification: 'MS', active: true, user_id: null },
  ]);
  vi.mocked(fetchBookingRules).mockResolvedValue([
    rule,
    { ...rule, id: 'other-rule', doctor_id: otherDoctorId },
  ]);
  vi.mocked(patchBookingRule).mockImplementation(async (_clinic, _ruleId, patch) => ({
    ...rule,
    ...patch,
  }));
  vi.mocked(previewBookingRuleChange).mockResolvedValue({ blocked: false, conflicts: [] });
  vi.mocked(fetchHolidays).mockResolvedValue([
    holiday('Personal leave', [doctorId]),
    holiday('Clinic closure', []),
    holiday('Team closure', [doctorId, otherDoctorId]),
    holiday('Other leave', [otherDoctorId]),
  ]);
  vi.mocked(createHoliday).mockImplementation(async (_clinic, input) => ({
    ...holiday('new-holiday', input.doctor_ids ?? []),
    ...input,
  }));
  vi.mocked(patchHoliday).mockResolvedValue(holiday('Personal leave', [doctorId]));
  vi.mocked(fetchDoctorSchedules).mockResolvedValue([
    {
      id: 'self-hours',
      doctor_id: doctorId,
      day_of_week: 1,
      start_time: '09:00',
      end_time: '13:00',
      active: true,
    },
  ]);
  vi.mocked(replaceDoctorSchedules).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Doctor settings', () => {
  it('shows the three requested sections with no other doctor selectors or admin settings requests', async () => {
    render(<DoctorSettings />);
    expect(await screen.findByText('Slot duration')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Holiday setup' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Doctor schedules' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Booking rules' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('Dr. Other')).not.toBeInTheDocument();
    expect(fetchClinicSettings).not.toHaveBeenCalled();
    expect(fetchAllDoctorSchedules).not.toHaveBeenCalled();
  });

  it('does not mount editors or send configuration requests without a linked doctor', () => {
    membershipDoctorId = null;
    render(<DoctorSettings />);
    expect(screen.getByRole('alert')).toHaveTextContent('not linked');
    expect(fetchBookingRules).not.toHaveBeenCalled();
    expect(fetchDoctorSchedules).not.toHaveBeenCalled();
    expect(fetchHolidays).not.toHaveBeenCalled();
  });

  it('lets the doctor preview and save their own rule without changing clinic settings', async () => {
    render(<BookingRules />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(
      screen.queryByRole('checkbox', { name: 'Allow doctor service edit' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Capacity per slot'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Booking rules saved.')).toBeInTheDocument();
    expect(previewBookingRuleChange).toHaveBeenCalledWith(clinicId, rule.id, {
      capacity_per_slot: 2,
    });
    expect(patchBookingRule).toHaveBeenCalledWith(clinicId, rule.id, {
      capacity_per_slot: 2,
    });
    expect(patchBookingRule).toHaveBeenCalledTimes(1);
    expect(patchClinicSettings).not.toHaveBeenCalled();
    expect(fetchClinicSettings).not.toHaveBeenCalled();
  });

  it('shows booking conflicts before allowing an explicit safe effective-date update', async () => {
    vi.mocked(previewBookingRuleChange).mockResolvedValue({
      blocked: true,
      conflicts: [appointmentConflict],
      next_safe_implement_from: '2026-12-21 00:00:00',
    });
    render(<BookingRules />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Slot duration (minutes)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Asha Patient/)).toBeInTheDocument();
    expect(patchBookingRule).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: /Implement from/ }));
    await waitFor(() =>
      expect(patchBookingRule).toHaveBeenCalledWith(clinicId, rule.id, {
        slot_duration_minutes: 30,
        implement_from: '2026-12-21 00:00:00',
      }),
    );
    expect(patchClinicSettings).not.toHaveBeenCalled();
  });

  it('shows clinic-wide and shared holidays read-only and only removes personal leave', async () => {
    render(<HolidaySetup />);
    expect(await screen.findByText('Personal leave')).toBeInTheDocument();
    expect(screen.getByText(/Set by clinic admin/)).toBeInTheDocument();
    expect(screen.getByText(/Clinic closure/)).toBeInTheDocument();
    expect(screen.getByText(/Team closure/)).toBeInTheDocument();
    expect(screen.queryByText('Other leave')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(patchHoliday).toHaveBeenCalledWith(clinicId, 'Personal leave', {
        active: false,
      }),
    );
  });

  it('creates holidays for this doctor only and never offers clinic-wide or other-doctor controls', async () => {
    render(<HolidaySetup />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getAllByLabelText('Holiday date')).toHaveLength(1);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Add holiday' }));
    fireEvent.change(screen.getAllByLabelText('Holiday date')[1]!, {
      target: { value: '2026-12-21' },
    });
    fireEvent.change(screen.getAllByLabelText('Holiday reason')[1]!, {
      target: { value: 'Personal appointment' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(createHoliday).toHaveBeenCalledWith(clinicId, {
        holiday_date: '2026-12-21',
        reason: 'Personal appointment',
        active: true,
        doctor_ids: [doctorId],
      }),
    );
    expect(createHoliday).toHaveBeenCalledTimes(1);
    expect(patchHoliday).not.toHaveBeenCalled();
  });

  it('keeps the holiday editor open and shows an appointment conflict when a personal leave update is blocked', async () => {
    vi.mocked(patchHoliday).mockRejectedValueOnce(conflictError());
    render(<HolidaySetup />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Holiday date'), { target: { value: '2026-12-21' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert', { name: 'Schedule conflicts' })).toHaveTextContent(
      'Asha Patient',
    );
    expect(screen.getByLabelText('Holiday date')).toHaveValue('2026-12-21');
    expect(patchHoliday).toHaveBeenCalledWith(
      clinicId,
      'Personal leave',
      expect.objectContaining({ doctor_ids: [doctorId] }),
    );
  });

  it('saves only the authenticated doctor schedule and shows appointment conflicts', async () => {
    vi.mocked(replaceDoctorSchedules).mockRejectedValueOnce(conflictError());
    render(<DoctorSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '12:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert', { name: 'Schedule conflicts' })).toHaveTextContent(
      'Asha Patient',
    );
    expect(replaceDoctorSchedules).toHaveBeenCalledWith(clinicId, doctorId, [
      { day_of_week: 1, start_time: '09:00', end_time: '12:00', active: true },
    ]);
    expect(replaceAllDoctorSchedules).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Recheck and save' }));
    expect(await screen.findByText(/Working hours saved/)).toBeInTheDocument();
  });
});
