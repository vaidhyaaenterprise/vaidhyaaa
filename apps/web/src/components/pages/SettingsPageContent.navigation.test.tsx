import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPageContent } from './SettingsPageContent';
import {
  fetchClinicLanguages,
  fetchClinicSubscription,
  fetchClinicUsage,
  fetchSupportedLanguages,
} from '@/lib/api/clinic-subscription';
import { fetchClinicSettings, type ClinicSettingsResponse } from '@/lib/api/clinic-settings';

const FIRST_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const SECOND_CLINIC_ID = '00000000-0000-0000-0000-000000000002';
let activeClinicId = FIRST_CLINIC_ID;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
  useAuth: () => ({ effectiveRole: 'admin' }),
}));

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => activeClinicId,
  useIsPlatformAdmin: () => false,
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
  replaceClinicLanguages: vi.fn(),
}));

const mockedFetchClinicSettings = vi.mocked(fetchClinicSettings);
const mockedFetchClinicSubscription = vi.mocked(fetchClinicSubscription);
const mockedFetchClinicUsage = vi.mocked(fetchClinicUsage);
const mockedFetchClinicLanguages = vi.mocked(fetchClinicLanguages);
const mockedFetchSupportedLanguages = vi.mocked(fetchSupportedLanguages);

beforeEach(() => {
  activeClinicId = FIRST_CLINIC_ID;
  mockedFetchClinicSettings.mockReset();
  mockedFetchClinicSubscription.mockReset().mockResolvedValue({
    plan_key: 'pilot',
    plan_name: 'Pilot',
    status: 'active',
    included_voice_minutes: 500,
    max_concurrent_calls: 3,
    recording_retention_days: 10,
    transcript_retention_days: 30,
  });
  mockedFetchClinicUsage.mockReset().mockResolvedValue({
    month: '2026-10',
    used_voice_minutes: 10,
    included_voice_minutes: 500,
    voice_call_count: 1,
  });
  mockedFetchClinicLanguages.mockReset().mockImplementation(async (clinicId) => ({
    default_language_code: clinicId === FIRST_CLINIC_ID ? 'tamil' : 'english',
    languages: [
      {
        language_code: clinicId === FIRST_CLINIC_ID ? 'tamil' : 'english',
        enabled: true,
        is_default: true,
      },
    ],
  }));
  mockedFetchSupportedLanguages.mockReset().mockResolvedValue([
    { language_code: 'english', display_name: 'English', enabled_platform_wide: true },
    { language_code: 'tamil', display_name: 'Tamil', enabled_platform_wide: true },
  ]);
});

afterEach(() => {
  cleanup();
});

describe('SettingsPageContent navigation safety', () => {
  it('aborts cancellable reads and ignores a stale settings response after clinic switch', async () => {
    const firstSettings = deferred<ClinicSettingsResponse>();
    mockedFetchClinicSettings.mockImplementation((clinicId) =>
      clinicId === FIRST_CLINIC_ID
        ? firstSettings.promise
        : Promise.resolve(clinicSettings(SECOND_CLINIC_ID)),
    );

    const { rerender } = render(<SettingsPageContent />);
    await waitFor(() => expect(mockedFetchClinicSettings).toHaveBeenCalledOnce());
    const firstLanguagesSignal = mockedFetchClinicLanguages.mock.calls[0]?.[1];
    const firstSubscriptionSignal = mockedFetchClinicSubscription.mock.calls[0]?.[1];

    activeClinicId = SECOND_CLINIC_ID;
    rerender(<SettingsPageContent />);

    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));
    expect(firstLanguagesSignal?.aborted).toBe(true);
    expect(firstSubscriptionSignal?.aborted).toBe(true);

    await act(async () => {
      firstSettings.resolve(clinicSettings(FIRST_CLINIC_ID));
      await firstSettings.promise;
    });

    expect(screen.queryByText('Tamil')).not.toBeInTheDocument();
    expect(screen.queryByText('Could not load settings')).not.toBeInTheDocument();
  });
});
