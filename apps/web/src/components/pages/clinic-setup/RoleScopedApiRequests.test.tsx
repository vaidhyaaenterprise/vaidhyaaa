import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPageContent } from '@/components/pages/SettingsPageContent';
import { BookingRules } from '@/components/pages/clinic-setup/BookingRules';
import { DoctorSchedule } from '@/components/pages/clinic-setup/DoctorSchedule';
import {
  fetchAllDoctorSchedules,
  fetchBookingRules,
  fetchDoctorSchedules,
  fetchDoctors,
} from '@/lib/api/clinic-clinical';
import {
  fetchClinicLanguages,
  fetchClinicSubscription,
  fetchClinicUsage,
  fetchSupportedLanguages,
} from '@/lib/api/clinic-subscription';
import { fetchClinicSettings } from '@/lib/api/clinic-settings';

const ACTIVE_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_CLINIC_ID = '00000000-0000-0000-0000-000000000002';
const ACTIVE_DOCTOR_ID = '00000000-0000-0000-0000-000000000101';
const OTHER_DOCTOR_ID = '00000000-0000-0000-0000-000000000102';

let clinicMemberships: Array<{
  clinic_id: string;
  role: 'clinic_admin' | 'doctor';
  doctor_id: string | null;
  active: boolean;
}> = [];

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    effectiveRole: 'doctor',
    me: {
      user: { platform_role: null },
      clinics: clinicMemberships,
    },
  }),
}));

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => ACTIVE_CLINIC_ID,
  useIsPlatformAdmin: () => false,
}));

vi.mock('@/lib/api/clinic-clinical', () => ({
  fetchAllDoctorSchedules: vi.fn(),
  fetchBookingRules: vi.fn(),
  fetchDoctorSchedules: vi.fn(),
  fetchDoctors: vi.fn(),
  patchBookingRule: vi.fn(),
  replaceDoctorSchedules: vi.fn(),
}));

vi.mock('@/lib/api/clinic-settings', () => ({
  fetchClinicSettings: vi.fn(),
  patchClinicSettings: vi.fn(),
}));

vi.mock('@/lib/api/clinic-subscription', () => ({
  changeClinicSubscription: vi.fn(),
  fetchClinicLanguages: vi.fn(),
  fetchClinicSubscription: vi.fn(),
  fetchClinicUsage: vi.fn(),
  fetchSupportedLanguages: vi.fn(),
  previewBookingRuleChange: vi.fn(),
  replaceClinicLanguages: vi.fn(),
}));

const mockedFetchAllDoctorSchedules = vi.mocked(fetchAllDoctorSchedules);
const mockedFetchBookingRules = vi.mocked(fetchBookingRules);
const mockedFetchClinicLanguages = vi.mocked(fetchClinicLanguages);
const mockedFetchClinicSettings = vi.mocked(fetchClinicSettings);
const mockedFetchClinicSubscription = vi.mocked(fetchClinicSubscription);
const mockedFetchClinicUsage = vi.mocked(fetchClinicUsage);
const mockedFetchDoctorSchedules = vi.mocked(fetchDoctorSchedules);
const mockedFetchDoctors = vi.mocked(fetchDoctors);
const mockedFetchSupportedLanguages = vi.mocked(fetchSupportedLanguages);

function bookingRule(id: string, doctorId: string) {
  return {
    id,
    doctor_id: doctorId,
    clinic_service_id: '00000000-0000-0000-0000-000000000201',
    slot_duration_minutes: 15,
    capacity_per_slot: 2,
    booking_horizon_days: 30,
    manual_edit_cutoff_before_start_minutes: 60,
    manual_edit_max_shift_minutes: 60,
    active: true,
  };
}

beforeEach(() => {
  clinicMemberships = [
    {
      clinic_id: OTHER_CLINIC_ID,
      role: 'doctor',
      doctor_id: OTHER_DOCTOR_ID,
      active: true,
    },
    {
      clinic_id: ACTIVE_CLINIC_ID,
      role: 'doctor',
      doctor_id: ACTIVE_DOCTOR_ID,
      active: true,
    },
  ];

  mockedFetchDoctors.mockReset().mockResolvedValue([
    {
      id: OTHER_DOCTOR_ID,
      name: 'Other Clinic Doctor',
      qualification: null,
      user_id: null,
      active: true,
    },
    {
      id: ACTIVE_DOCTOR_ID,
      name: 'Active Clinic Doctor',
      qualification: null,
      user_id: null,
      active: true,
    },
  ]);
  mockedFetchBookingRules
    .mockReset()
    .mockResolvedValue([
      bookingRule('00000000-0000-0000-0000-000000000301', OTHER_DOCTOR_ID),
      bookingRule('00000000-0000-0000-0000-000000000302', ACTIVE_DOCTOR_ID),
    ]);
  mockedFetchAllDoctorSchedules.mockReset().mockResolvedValue([]);
  mockedFetchDoctorSchedules.mockReset().mockResolvedValue([
    {
      id: '00000000-0000-0000-0000-000000000401',
      doctor_id: ACTIVE_DOCTOR_ID,
      day_of_week: 1,
      start_time: '09:00',
      end_time: '13:00',
      active: true,
    },
  ]);
  mockedFetchClinicSettings.mockReset();
  mockedFetchClinicSubscription.mockReset();
  mockedFetchClinicUsage.mockReset();
  mockedFetchClinicLanguages.mockReset().mockResolvedValue({
    default_language_code: 'english',
    languages: [{ language_code: 'english', enabled: true, is_default: true }],
  });
  mockedFetchSupportedLanguages.mockReset().mockResolvedValue([
    { language_code: 'english', display_name: 'English', enabled_platform_wide: true },
  ]);
});

afterEach(() => {
  cleanup();
});

describe('doctor-scoped clinic setup requests', () => {
  it('loads booking rules without the admin-only settings API or another doctor fallback', async () => {
    render(<BookingRules />);

    expect(await screen.findByText('Active Clinic Doctor')).toBeInTheDocument();
    expect(screen.queryByText('Other Clinic Doctor')).not.toBeInTheDocument();
    expect(screen.queryByText('Doctor service edit')).not.toBeInTheDocument();
    expect(mockedFetchClinicSettings).not.toHaveBeenCalled();
    expect(mockedFetchBookingRules).toHaveBeenCalledWith(
      ACTIVE_CLINIC_ID,
      expect.any(AbortSignal),
    );
  });

  it('loads the schedule using the doctor membership for the active clinic', async () => {
    render(<DoctorSchedule />);

    expect(await screen.findByText('Active Clinic Doctor')).toBeInTheDocument();
    expect(mockedFetchDoctorSchedules).toHaveBeenCalledWith(
      ACTIVE_CLINIC_ID,
      ACTIVE_DOCTOR_ID,
      expect.any(AbortSignal),
    );
    expect(mockedFetchDoctorSchedules).not.toHaveBeenCalledWith(
      ACTIVE_CLINIC_ID,
      OTHER_DOCTOR_ID,
    );
    expect(mockedFetchAllDoctorSchedules).not.toHaveBeenCalled();
  });
});

describe('doctor settings requests', () => {
  it('loads language data without unused subscription and usage requests', async () => {
    render(<SettingsPageContent />);

    expect(await screen.findByText('Language settings')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockedFetchClinicLanguages).toHaveBeenCalledWith(
        ACTIVE_CLINIC_ID,
        expect.any(AbortSignal),
      );
      expect(mockedFetchSupportedLanguages).toHaveBeenCalledOnce();
    });
    expect(mockedFetchClinicSettings).not.toHaveBeenCalled();
    expect(mockedFetchClinicSubscription).not.toHaveBeenCalled();
    expect(mockedFetchClinicUsage).not.toHaveBeenCalled();
  });
});
