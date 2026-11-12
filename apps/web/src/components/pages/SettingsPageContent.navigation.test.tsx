import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPageContent } from './SettingsPageContent';
import { ApiRequestError } from '@/lib/api/client';
import {
  fetchClinicLanguages,
  fetchClinicSubscription,
  fetchClinicUsage,
  replaceClinicLanguages,
} from '@/lib/api/clinic-subscription';
import {
  fetchClinicSettings,
  patchClinicSettings,
  type ClinicSettingsResponse,
} from '@/lib/api/clinic-settings';

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

function clinicLanguages(defaultLanguageCode: 'ta_tanglish' | 'english' = 'ta_tanglish') {
  return {
    default_language_code: defaultLanguageCode,
    languages: [
      {
        language_code: 'ta_tanglish',
        enabled: true,
        is_default: defaultLanguageCode === 'ta_tanglish',
      },
      {
        language_code: 'english',
        enabled: true,
        is_default: defaultLanguageCode === 'english',
      },
    ],
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
  replaceClinicLanguages: vi.fn(),
}));

const mockedFetchClinicSettings = vi.mocked(fetchClinicSettings);
const mockedPatchClinicSettings = vi.mocked(patchClinicSettings);
const mockedFetchClinicLanguages = vi.mocked(fetchClinicLanguages);
const mockedFetchClinicSubscription = vi.mocked(fetchClinicSubscription);
const mockedFetchClinicUsage = vi.mocked(fetchClinicUsage);
const mockedReplaceClinicLanguages = vi.mocked(replaceClinicLanguages);

beforeEach(() => {
  activeClinicId = FIRST_CLINIC_ID;
  mockedFetchClinicSettings.mockReset();
  mockedPatchClinicSettings
    .mockReset()
    .mockImplementation(async (clinicId) => clinicSettings(clinicId));
  mockedFetchClinicLanguages.mockReset().mockResolvedValue(clinicLanguages());
  mockedReplaceClinicLanguages
    .mockReset()
    .mockImplementation(async (_clinicId, payload) =>
      clinicLanguages(payload.default_language_code === 'english' ? 'english' : 'ta_tanglish'),
    );
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
});

afterEach(() => {
  cleanup();
});

describe('SettingsPageContent navigation safety', () => {
  it('loads required clinic settings first and caps optional request concurrency', async () => {
    const requiredSettings = deferred<ClinicSettingsResponse>();
    const subscription = deferred<Awaited<ReturnType<typeof fetchClinicSubscription>>>();
    const usage = deferred<Awaited<ReturnType<typeof fetchClinicUsage>>>();
    mockedFetchClinicSettings.mockReturnValue(requiredSettings.promise);
    mockedFetchClinicSubscription.mockReturnValue(subscription.promise);
    mockedFetchClinicUsage.mockReturnValue(usage.promise);

    render(<SettingsPageContent />);

    await waitFor(() => expect(mockedFetchClinicSettings).toHaveBeenCalledOnce());
    expect(mockedFetchClinicLanguages).not.toHaveBeenCalled();
    expect(mockedFetchClinicSubscription).not.toHaveBeenCalled();
    expect(mockedFetchClinicUsage).not.toHaveBeenCalled();

    await act(async () => {
      requiredSettings.resolve(clinicSettings(FIRST_CLINIC_ID));
      await requiredSettings.promise;
    });

    await waitFor(() => {
      expect(mockedFetchClinicLanguages).toHaveBeenCalledWith(
        FIRST_CLINIC_ID,
        expect.any(AbortSignal),
      );
      expect(mockedFetchClinicSubscription).toHaveBeenCalledOnce();
      expect(mockedFetchClinicUsage).toHaveBeenCalledOnce();
    });

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
    expect(mockedFetchClinicLanguages).not.toHaveBeenCalled();
    expect(mockedFetchClinicSubscription).not.toHaveBeenCalled();
    expect(mockedFetchClinicUsage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Agent settings')).toBeInTheDocument();
    expect(mockedFetchClinicSettings).toHaveBeenCalledTimes(2);
    expect(mockedFetchClinicLanguages).toHaveBeenCalledOnce();
    expect(mockedFetchClinicSubscription).toHaveBeenCalledOnce();
    expect(mockedFetchClinicUsage).toHaveBeenCalledOnce();
    expect(screen.queryByText('Could not load settings')).not.toBeInTheDocument();
  });

  it('renders required settings with safe fallbacks when every optional request fails', async () => {
    mockedFetchClinicSettings.mockResolvedValue(clinicSettings(FIRST_CLINIC_ID));
    mockedFetchClinicLanguages.mockRejectedValue(new Error('languages unavailable'));
    mockedFetchClinicSubscription.mockRejectedValue(new Error('subscription unavailable'));
    mockedFetchClinicUsage.mockRejectedValue(new Error('usage unavailable'));

    render(<SettingsPageContent />);

    expect(await screen.findByText('Agent settings')).toBeInTheDocument();
    expect(screen.queryByText('Language settings')).not.toBeInTheDocument();
    expect(screen.getByText('Tanglish')).toBeInTheDocument();
    expect(screen.queryByText('Could not load settings')).not.toBeInTheDocument();
    expect(mockedFetchClinicSettings).toHaveBeenCalledOnce();
    expect(mockedFetchClinicLanguages).toHaveBeenCalledOnce();
    expect(mockedFetchClinicSubscription).toHaveBeenCalledOnce();
    expect(mockedFetchClinicUsage).toHaveBeenCalledOnce();
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
    expect(mockedFetchClinicSubscription).not.toHaveBeenCalled();

    activeClinicId = SECOND_CLINIC_ID;
    rerender(<SettingsPageContent />);

    expect(await screen.findByText('Agent settings')).toBeInTheDocument();
    expect(firstSettingsSignal?.aborted).toBe(true);
    expect(mockedFetchClinicLanguages).toHaveBeenCalledOnce();
    expect(mockedFetchClinicLanguages.mock.calls[0]?.[0]).toBe(SECOND_CLINIC_ID);
    expect(mockedFetchClinicSubscription).toHaveBeenCalledOnce();
    expect(mockedFetchClinicSubscription.mock.calls[0]?.[0]).toBe(SECOND_CLINIC_ID);

    await act(async () => {
      firstSettings.resolve(clinicSettings(FIRST_CLINIC_ID));
      await firstSettings.promise;
    });

    expect(screen.queryByText('Could not load settings')).not.toBeInTheDocument();
  });

  it('defaults to Tanglish and persists a changed language from Agent settings', async () => {
    mockedFetchClinicSettings.mockResolvedValue(clinicSettings(FIRST_CLINIC_ID));

    render(<SettingsPageContent />);

    expect(await screen.findByText('Agent settings')).toBeInTheDocument();
    expect(screen.getByText('Tanglish')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    const languageSelect = screen.getByRole('combobox', { name: 'Agent language' });
    expect(languageSelect).toHaveValue('ta_tanglish');
    fireEvent.change(languageSelect, { target: { value: 'english' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedReplaceClinicLanguages).toHaveBeenCalledWith(FIRST_CLINIC_ID, {
        default_language_code: 'english',
        languages: [
          { language_code: 'ta_tanglish', enabled: true, is_default: false },
          { language_code: 'english', enabled: true, is_default: true },
        ],
      });
    });
    expect(await screen.findByText('English')).toBeInTheDocument();
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
    mockedFetchClinicUsage.mockImplementation((clinicId, signal) =>
      clinicId === FIRST_CLINIC_ID
        ? pendingUntilAbort(signal)
        : Promise.resolve({
            month: '2026-10',
            used_voice_minutes: 10,
            included_voice_minutes: 500,
            voice_call_count: 1,
          }),
    );

    const { rerender } = render(<SettingsPageContent />);
    await waitFor(() => {
      expect(mockedFetchClinicSubscription).toHaveBeenCalledOnce();
      expect(mockedFetchClinicUsage).toHaveBeenCalledOnce();
    });
    const firstSubscriptionSignal = mockedFetchClinicSubscription.mock.calls[0]?.[1];
    const firstUsageSignal = mockedFetchClinicUsage.mock.calls[0]?.[1];

    activeClinicId = SECOND_CLINIC_ID;
    rerender(<SettingsPageContent />);

    expect(await screen.findByText('Agent settings')).toBeInTheDocument();
    expect(firstSubscriptionSignal?.aborted).toBe(true);
    expect(firstUsageSignal?.aborted).toBe(true);
    expect(mockedFetchClinicUsage).toHaveBeenCalledTimes(2);
    expect(mockedFetchClinicUsage.mock.calls[1]?.[0]).toBe(SECOND_CLINIC_ID);
    expect(screen.queryByText('Could not load settings')).not.toBeInTheDocument();
  });
});
