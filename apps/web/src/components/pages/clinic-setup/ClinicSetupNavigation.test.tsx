import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClinicSetupPageContent } from '@/components/pages/ClinicSetupPageContent';
import {
  fetchAllDoctorSchedules,
  fetchBookingRules,
  fetchClinicHours,
  fetchDoctorServices,
  fetchDoctors,
  fetchHolidays,
  fetchServices,
  type DoctorApiRow,
} from '@/lib/api/clinic-clinical';
import { fetchClinicSettings, type ClinicSettingsResponse } from '@/lib/api/clinic-settings';
import { fetchClinicUsers } from '@/lib/api/clinic-users';

const FIRST_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const SECOND_CLINIC_ID = '00000000-0000-0000-0000-000000000002';
const FIRST_DOCTOR_ID = '00000000-0000-0000-0000-000000000101';
const SECOND_DOCTOR_ID = '00000000-0000-0000-0000-000000000102';
let activeClinicId = FIRST_CLINIC_ID;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function doctor(id: string, name: string): DoctorApiRow {
  return { id, name, qualification: 'MD', user_id: null, active: true };
}

function clinicSettings(clinicId: string): ClinicSettingsResponse {
  return {
    clinic_id: clinicId,
    agent_enabled: true,
    answering_mode: 'always',
    fallback_phone: null,
    overflow_after_rings: null,
    booking_mode: 'pending_confirmation',
    max_concurrent_calls: 3,
    recording_retention_days: 10,
    transcript_retention_days: 30,
    notify_staff_on_pending_appointment: true,
    pending_appointment_notification_channel: null,
    allow_doctor_service_edit: false,
    allow_patient_auto_cancel: false,
  };
}

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    effectiveRole: 'admin',
    me: {
      user: { id: '00000000-0000-0000-0000-000000000201' },
      clinics: [
        {
          clinic_id: activeClinicId,
          role: 'clinic_admin',
          doctor_id: null,
          active: true,
        },
      ],
    },
  }),
}));

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => activeClinicId,
}));

vi.mock('@/lib/api/clinic-clinical', () => ({
  createDoctor: vi.fn(),
  createDoctorService: vi.fn(),
  createHoliday: vi.fn(),
  createService: vi.fn(),
  deleteDoctor: vi.fn(),
  fetchAllDoctorSchedules: vi.fn(),
  fetchBookingRules: vi.fn(),
  fetchClinicHours: vi.fn(),
  fetchDoctorSchedules: vi.fn(),
  fetchDoctorServices: vi.fn(),
  fetchDoctors: vi.fn(),
  fetchHolidays: vi.fn(),
  fetchServices: vi.fn(),
  patchBookingRule: vi.fn(),
  patchDoctorService: vi.fn(),
  patchHoliday: vi.fn(),
  patchService: vi.fn(),
  replaceClinicHours: vi.fn(),
  replaceDoctorSchedules: vi.fn(),
}));

vi.mock('@/lib/api/clinic-settings', () => ({
  fetchClinicSettings: vi.fn(),
  patchClinicSettings: vi.fn(),
}));

vi.mock('@/lib/api/clinic-subscription', () => ({
  previewBookingRuleChange: vi.fn(),
}));

vi.mock('@/lib/api/clinic-users', () => ({
  createClinicUserLogin: vi.fn(),
  deleteClinicUserLogin: vi.fn(),
  disableClinicUser: vi.fn(),
  enableClinicUser: vi.fn(),
  fetchClinicUsers: vi.fn(),
  updateClinicUserLogin: vi.fn(),
}));

const mockedFetchDoctors = vi.mocked(fetchDoctors);
const mockedFetchServices = vi.mocked(fetchServices);
const mockedFetchDoctorServices = vi.mocked(fetchDoctorServices);
const mockedFetchClinicHours = vi.mocked(fetchClinicHours);
const mockedFetchHolidays = vi.mocked(fetchHolidays);
const mockedFetchAllDoctorSchedules = vi.mocked(fetchAllDoctorSchedules);
const mockedFetchBookingRules = vi.mocked(fetchBookingRules);
const mockedFetchClinicSettings = vi.mocked(fetchClinicSettings);
const mockedFetchClinicUsers = vi.mocked(fetchClinicUsers);

beforeEach(() => {
  activeClinicId = FIRST_CLINIC_ID;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('Clinic Setup navigation safety', () => {
  it('aborts all six sections on clinic switch, ignores stale results, and aborts on unmount', async () => {
    const firstDoctors = deferred<DoctorApiRow[]>();
    const firstServices = deferred<Awaited<ReturnType<typeof fetchServices>>>();
    const firstMappings = deferred<Awaited<ReturnType<typeof fetchDoctorServices>>>();
    const firstHolidays = deferred<Awaited<ReturnType<typeof fetchHolidays>>>();
    const firstSchedules = deferred<Awaited<ReturnType<typeof fetchAllDoctorSchedules>>>();
    const firstRules = deferred<Awaited<ReturnType<typeof fetchBookingRules>>>();
    const firstSettings = deferred<ClinicSettingsResponse>();
    const firstUsers = deferred<Awaited<ReturnType<typeof fetchClinicUsers>>>();

    mockedFetchDoctors.mockImplementation((clinicId) =>
      clinicId === FIRST_CLINIC_ID
        ? firstDoctors.promise
        : Promise.resolve([doctor(SECOND_DOCTOR_ID, 'Second Clinic Doctor')]),
    );
    mockedFetchServices.mockImplementation((clinicId) =>
      clinicId === FIRST_CLINIC_ID ? firstServices.promise : Promise.resolve([]),
    );
    mockedFetchDoctorServices.mockImplementation((clinicId) =>
      clinicId === FIRST_CLINIC_ID ? firstMappings.promise : Promise.resolve([]),
    );
    mockedFetchClinicHours.mockImplementation((clinicId, signal) => {
      if (clinicId !== FIRST_CLINIC_ID) {
        return Promise.resolve([]);
      }
      return new Promise((_, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted.', 'AbortError')),
          { once: true },
        );
      });
    });
    mockedFetchHolidays.mockImplementation((clinicId) =>
      clinicId === FIRST_CLINIC_ID ? firstHolidays.promise : Promise.resolve([]),
    );
    mockedFetchAllDoctorSchedules.mockImplementation((clinicId) =>
      clinicId === FIRST_CLINIC_ID ? firstSchedules.promise : Promise.resolve([]),
    );
    mockedFetchBookingRules.mockImplementation((clinicId) =>
      clinicId === FIRST_CLINIC_ID ? firstRules.promise : Promise.resolve([]),
    );
    mockedFetchClinicSettings.mockImplementation((clinicId) =>
      clinicId === FIRST_CLINIC_ID
        ? firstSettings.promise
        : Promise.resolve(clinicSettings(SECOND_CLINIC_ID)),
    );
    mockedFetchClinicUsers.mockImplementation((clinicId) =>
      clinicId === FIRST_CLINIC_ID
        ? firstUsers.promise
        : Promise.resolve({ users: [], clinic_login_number: '1002' }),
    );

    const { rerender, unmount } = render(<ClinicSetupPageContent />);
    await waitFor(() => {
      expect(mockedFetchClinicUsers).toHaveBeenCalledWith(
        FIRST_CLINIC_ID,
        expect.any(AbortSignal),
      );
      expect(mockedFetchClinicHours).toHaveBeenCalledWith(
        FIRST_CLINIC_ID,
        expect.any(AbortSignal),
      );
    });

    const firstClinicSignals = [
      ...mockedFetchDoctors.mock.calls
        .filter(([clinicId]) => clinicId === FIRST_CLINIC_ID)
        .map(([, signal]) => signal),
      mockedFetchServices.mock.calls.find(([clinicId]) => clinicId === FIRST_CLINIC_ID)?.[1],
      mockedFetchDoctorServices.mock.calls.find(([clinicId]) => clinicId === FIRST_CLINIC_ID)?.[1],
      mockedFetchClinicHours.mock.calls.find(([clinicId]) => clinicId === FIRST_CLINIC_ID)?.[1],
      mockedFetchHolidays.mock.calls.find(([clinicId]) => clinicId === FIRST_CLINIC_ID)?.[1],
      mockedFetchAllDoctorSchedules.mock.calls.find(
        ([clinicId]) => clinicId === FIRST_CLINIC_ID,
      )?.[1],
      mockedFetchBookingRules.mock.calls.find(([clinicId]) => clinicId === FIRST_CLINIC_ID)?.[1],
      mockedFetchClinicSettings.mock.calls.find(([clinicId]) => clinicId === FIRST_CLINIC_ID)?.[1],
      mockedFetchClinicUsers.mock.calls.find(([clinicId]) => clinicId === FIRST_CLINIC_ID)?.[1],
    ].filter((signal): signal is AbortSignal => signal instanceof AbortSignal);

    activeClinicId = SECOND_CLINIC_ID;
    rerender(<ClinicSetupPageContent />);

    expect(await screen.findAllByText('Second Clinic Doctor')).not.toHaveLength(0);
    expect(firstClinicSignals).toHaveLength(13);
    expect(firstClinicSignals.every((signal) => signal.aborted)).toBe(true);

    await act(async () => {
      firstDoctors.resolve([doctor(FIRST_DOCTOR_ID, 'First Clinic Doctor')]);
      firstServices.resolve([]);
      firstMappings.resolve([]);
      firstHolidays.resolve([]);
      firstSchedules.resolve([]);
      firstRules.resolve([]);
      firstSettings.resolve(clinicSettings(FIRST_CLINIC_ID));
      firstUsers.resolve({ users: [], clinic_login_number: '1001' });
      await Promise.all([
        firstDoctors.promise,
        firstServices.promise,
        firstMappings.promise,
        firstHolidays.promise,
        firstSchedules.promise,
        firstRules.promise,
        firstSettings.promise,
        firstUsers.promise,
      ]);
    });

    expect(screen.queryByText('First Clinic Doctor')).not.toBeInTheDocument();
    expect(screen.queryByText(/Could not load/)).not.toBeInTheDocument();

    const secondClinicSignals = [
      ...mockedFetchDoctors.mock.calls
        .filter(([clinicId]) => clinicId === SECOND_CLINIC_ID)
        .map(([, signal]) => signal),
      mockedFetchServices.mock.calls.find(([clinicId]) => clinicId === SECOND_CLINIC_ID)?.[1],
      mockedFetchDoctorServices.mock.calls.find(([clinicId]) => clinicId === SECOND_CLINIC_ID)?.[1],
      mockedFetchClinicHours.mock.calls.find(([clinicId]) => clinicId === SECOND_CLINIC_ID)?.[1],
      mockedFetchHolidays.mock.calls.find(([clinicId]) => clinicId === SECOND_CLINIC_ID)?.[1],
      mockedFetchAllDoctorSchedules.mock.calls.find(
        ([clinicId]) => clinicId === SECOND_CLINIC_ID,
      )?.[1],
      mockedFetchBookingRules.mock.calls.find(([clinicId]) => clinicId === SECOND_CLINIC_ID)?.[1],
      mockedFetchClinicSettings.mock.calls.find(([clinicId]) => clinicId === SECOND_CLINIC_ID)?.[1],
      mockedFetchClinicUsers.mock.calls.find(([clinicId]) => clinicId === SECOND_CLINIC_ID)?.[1],
    ].filter((signal): signal is AbortSignal => signal instanceof AbortSignal);

    unmount();
    expect(secondClinicSignals).toHaveLength(13);
    expect(secondClinicSignals.every((signal) => signal.aborted)).toBe(true);
  });
});
