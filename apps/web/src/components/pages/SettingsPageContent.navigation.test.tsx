import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPageContent } from './SettingsPageContent';
import { ApiRequestError } from '@/lib/api/client';
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

function pendingUntilAbort<T>(signal?: AbortSignal): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    const rejectWithAbort = () => {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      reject(error);
    };

    if (signal?.aborted) {
      rejectWithAbort();
      return;
    }
    signal?.addEventListener('abort', rejectWithAbort, { once: true });
  });
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

function serviceUnavailable(requestId: string) {
  return new ApiRequestError({
    code: 'INTERNAL_ERROR',
    message: 'The service is temporarily unavailable. Please try again shortly.',
    requestId,
    details: {},
  });
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
  it('loads required clinic settings first and caps optional request concurrency', async () => {
    const requiredSettings = deferred<ClinicSettingsResponse>();
    const subscription = deferred<Awaited<ReturnType<typeof fetchClinicSubscription>>>();
    const usage = deferred<Awaited<ReturnType<typeof fetchClinicUsage>>>();
    const clinicLanguages = deferred<Awaited<ReturnType<typeof fetchClinicLanguages>>>();
    mockedFetchClinicSettings.mockReturnValue(requiredSettings.promise);
    mockedFetchClinicSubscription.mockReturnValue(subscription.promise);
    mockedFetchClinicUsage.mockReturnValue(usage.promise);
    mockedFetchClinicLanguages.mockReturnValue(clinicLanguages.promise);

    render(<SettingsPageContent />);

    await waitFor(() => expect(mockedFetchClinicSettings).toHaveBeenCalledOnce());
    expect(mockedFetchClinicSubscription).not.toHaveBeenCalled();
    expect(mockedFetchClinicUsage).not.toHaveBeenCalled();
    expect(mockedFetchClinicLanguages).not.toHaveBeenCalled();
    expect(mockedFetchSupportedLanguages).not.toHaveBeenCalled();

    await act(async () => {
      requiredSettings.resolve(clinicSettings(FIRST_CLINIC_ID));
      await requiredSettings.promise;
    });

    await waitFor(() => {
      expect(mockedFetchClinicSubscription).toHaveBeenCalledOnce();
      expect(mockedFetchClinicLanguages).toHaveBeenCalledOnce();
    });
    expect(mockedFetchClinicUsage).not.toHaveBeenCalled();
    expect(mockedFetchSupportedLanguages).not.toHaveBeenCalled();

    await act(async () => {
      subscription.resolve({
        plan_key: 'pilot',
        plan_name: 'Pilot',
        status: 'active',
        included_voice_minutes: 500,
        max_concurrent_calls: 3,
        recording_retention_days: 10,
        transcript_retention_days: 30,
      });
      await subscription.promise;
    });

    await waitFor(() => expect(mockedFetchClinicUsage).toHaveBeenCalledOnce());
    expect(mockedFetchSupportedLanguages).not.toHaveBeenCalled();

    await act(async () => {
      clinicLanguages.resolve({
        default_language_code: 'tamil',
        languages: [{ language_code: 'tamil', enabled: true, is_default: true }],
      });
      await clinicLanguages.promise;
    });

    await waitFor(() => expect(mockedFetchSupportedLanguages).toHaveBeenCalledOnce());

    await act(async () => {
      usage.resolve({
        month: '2026-10',
        used_voice_minutes: 10,
        included_voice_minutes: 500,
        voice_call_count: 1,
      });
      await usage.promise;
    });
    expect(await screen.findByText('Agent settings')).toBeInTheDocument();
  });

  it('keeps a required-settings failure terminal until a manual retry succeeds', async () => {
    mockedFetchClinicSettings
      .mockRejectedValueOnce(serviceUnavailable('req_settings_terminal'))
      .mockResolvedValueOnce(clinicSettings(FIRST_CLINIC_ID));

    render(<SettingsPageContent />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load settings');
    expect(alert).toHaveTextContent('req_settings_terminal');
    expect(mockedFetchClinicSettings).toHaveBeenCalledOnce();
    expect(mockedFetchClinicSubscription).not.toHaveBeenCalled();
    expect(mockedFetchClinicUsage).not.toHaveBeenCalled();
    expect(mockedFetchClinicLanguages).not.toHaveBeenCalled();
    expect(mockedFetchSupportedLanguages).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Agent settings')).toBeInTheDocument();
    expect(mockedFetchClinicSettings).toHaveBeenCalledTimes(2);
    expect(mockedFetchClinicSubscription).toHaveBeenCalledOnce();
    expect(mockedFetchClinicUsage).toHaveBeenCalledOnce();
    expect(mockedFetchClinicLanguages).toHaveBeenCalledOnce();
    expect(mockedFetchSupportedLanguages).toHaveBeenCalledOnce();
    expect(screen.queryByText('Could not load settings')).not.toBeInTheDocument();
  });

  it('renders required settings with safe fallbacks when every optional request fails', async () => {
    mockedFetchClinicSettings.mockResolvedValue(clinicSettings(FIRST_CLINIC_ID));
    mockedFetchClinicSubscription.mockRejectedValue(new Error('subscription unavailable'));
    mockedFetchClinicUsage.mockRejectedValue(new Error('usage unavailable'));
    mockedFetchClinicLanguages.mockRejectedValue(new Error('clinic languages unavailable'));
    mockedFetchSupportedLanguages.mockRejectedValue(new Error('language catalog unavailable'));

    render(<SettingsPageContent />);

    expect(await screen.findByText('Agent settings')).toBeInTheDocument();
    expect(screen.getByText('Language settings')).toBeInTheDocument();
    expect(screen.getAllByText('Tanglish').length).toBeGreaterThan(0);
    expect(screen.queryByText('Could not load settings')).not.toBeInTheDocument();
    expect(mockedFetchClinicSettings).toHaveBeenCalledOnce();
    expect(mockedFetchClinicSubscription).toHaveBeenCalledOnce();
    expect(mockedFetchClinicUsage).toHaveBeenCalledOnce();
    expect(mockedFetchClinicLanguages).toHaveBeenCalledOnce();
    expect(mockedFetchSupportedLanguages).toHaveBeenCalledOnce();
  });

  it('aborts cancellable reads and ignores a stale settings response after clinic switch', async () => {
    const firstSettings = deferred<ClinicSettingsResponse>();
    mockedFetchClinicSettings.mockImplementation((clinicId) =>
      clinicId === FIRST_CLINIC_ID
        ? firstSettings.promise
        : Promise.resolve(clinicSettings(SECOND_CLINIC_ID)),
    );

    const { rerender } = render(<SettingsPageContent />);
    await waitFor(() => expect(mockedFetchClinicSettings).toHaveBeenCalledOnce());
    const firstSettingsSignal = mockedFetchClinicSettings.mock.calls[0]?.[1];
    expect(mockedFetchClinicLanguages).not.toHaveBeenCalled();
    expect(mockedFetchClinicSubscription).not.toHaveBeenCalled();

    activeClinicId = SECOND_CLINIC_ID;
    rerender(<SettingsPageContent />);

    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));
    expect(firstSettingsSignal?.aborted).toBe(true);
    expect(mockedFetchClinicLanguages).toHaveBeenCalledOnce();
    expect(mockedFetchClinicLanguages.mock.calls[0]?.[0]).toBe(SECOND_CLINIC_ID);
    expect(mockedFetchClinicSubscription).toHaveBeenCalledOnce();
    expect(mockedFetchClinicSubscription.mock.calls[0]?.[0]).toBe(SECOND_CLINIC_ID);

    await act(async () => {
      firstSettings.resolve(clinicSettings(FIRST_CLINIC_ID));
      await firstSettings.promise;
    });

    expect(screen.queryByText('Tamil')).not.toBeInTheDocument();
    expect(screen.queryByText('Could not load settings')).not.toBeInTheDocument();
  });

  it('aborts optional reads and does not start queued work for the previous clinic', async () => {
    mockedFetchClinicSettings.mockImplementation(async (clinicId) => clinicSettings(clinicId));
    mockedFetchClinicSubscription.mockImplementation((clinicId, signal) =>
      clinicId === FIRST_CLINIC_ID
        ? pendingUntilAbort(signal)
        : Promise.resolve({
            plan_key: 'pilot',
            plan_name: 'Pilot',
            status: 'active',
            included_voice_minutes: 500,
            max_concurrent_calls: 3,
            recording_retention_days: 10,
            transcript_retention_days: 30,
          }),
    );
    mockedFetchClinicLanguages.mockImplementation((clinicId, signal) =>
      clinicId === FIRST_CLINIC_ID
        ? pendingUntilAbort(signal)
        : Promise.resolve({
            default_language_code: 'english',
            languages: [{ language_code: 'english', enabled: true, is_default: true }],
          }),
    );

    const { rerender } = render(<SettingsPageContent />);
    await waitFor(() => {
      expect(mockedFetchClinicSubscription).toHaveBeenCalledOnce();
      expect(mockedFetchClinicLanguages).toHaveBeenCalledOnce();
    });
    const firstSubscriptionSignal = mockedFetchClinicSubscription.mock.calls[0]?.[1];
    const firstLanguagesSignal = mockedFetchClinicLanguages.mock.calls[0]?.[1];

    activeClinicId = SECOND_CLINIC_ID;
    rerender(<SettingsPageContent />);

    expect(await screen.findByText('Agent settings')).toBeInTheDocument();
    expect(firstSubscriptionSignal?.aborted).toBe(true);
    expect(firstLanguagesSignal?.aborted).toBe(true);
    expect(mockedFetchClinicUsage).toHaveBeenCalledTimes(1);
    expect(mockedFetchClinicUsage.mock.calls[0]?.[0]).toBe(SECOND_CLINIC_ID);
    expect(mockedFetchSupportedLanguages).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('English').length).toBeGreaterThan(0);
    expect(screen.queryByText('Tamil')).not.toBeInTheDocument();
    expect(screen.queryByText('Could not load settings')).not.toBeInTheDocument();
  });
});
