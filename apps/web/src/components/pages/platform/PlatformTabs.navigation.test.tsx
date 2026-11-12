import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobHealthDashboard } from './JobHealthDashboard';
import { NotificationEventsList } from './NotificationEventsList';
import { PlatformClinicsList } from './PlatformClinicsList';
import {
  fetchPlatformJobHealth,
  fetchPlatformNotifications,
} from '@/lib/api/clinic-clinical';
import {
  fetchPlatformClinics,
  fetchPlatformOnboarding,
  type PlatformClinicRow,
} from '@/lib/api/platform';

let isPlatformAdmin = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

vi.mock('@/hooks/useActiveClinicId', () => ({
  useIsPlatformAdmin: () => isPlatformAdmin,
}));

vi.mock('@/lib/api/platform', () => ({
  activatePlatformClinic: vi.fn(),
  fetchPlatformClinics: vi.fn(),
  fetchPlatformOnboarding: vi.fn(),
  suspendPlatformClinic: vi.fn(),
}));

vi.mock('@/lib/api/clinic-clinical', () => ({
  fetchPlatformJobHealth: vi.fn(),
  fetchPlatformNotifications: vi.fn(),
}));

vi.mock('@/lib/api/clinic-subscription', () => ({
  cancelPlatformNotification: vi.fn(),
  retryPlatformNotification: vi.fn(),
}));

const mockedFetchClinics = vi.mocked(fetchPlatformClinics);
const mockedFetchOnboarding = vi.mocked(fetchPlatformOnboarding);
const mockedFetchNotifications = vi.mocked(fetchPlatformNotifications);
const mockedFetchJobHealth = vi.mocked(fetchPlatformJobHealth);

function clinic(id: string, name: string): PlatformClinicRow {
  return {
    id,
    name,
    active: true,
    onboarding_status: 'in_progress',
  };
}

function notification(id: string, clinicId: string) {
  return {
    id,
    clinic_id: clinicId,
    event_type: 'appointment.confirmed',
    channel: 'sms',
    status: 'sent',
    attempt_count: 1,
    last_error: null,
    created_at: '2026-10-01T08:00:00.000Z',
  };
}

function jobHealth(jobType: string) {
  return {
    health: [],
    recent_runs: [
      {
        id: `run-${jobType}`,
        clinic_id: null,
        job_type: jobType,
        status: 'completed',
        attempt_count: 1,
        last_error: null,
        scheduled_at: '2026-10-01T08:00:00.000Z',
        completed_at: '2026-10-01T08:00:01.000Z',
        created_at: '2026-10-01T08:00:00.000Z',
      },
    ],
  };
}

beforeEach(() => {
  isPlatformAdmin = true;
  mockedFetchClinics.mockReset().mockResolvedValue([]);
  mockedFetchOnboarding.mockReset();
  mockedFetchNotifications.mockReset().mockResolvedValue([]);
  mockedFetchJobHealth.mockReset().mockResolvedValue({ health: [], recent_runs: [] });
});

afterEach(() => {
  cleanup();
});

describe('internal platform tab navigation safety', () => {
  it('aborts the clinics request and ignores its stale response when access context changes', async () => {
    const staleRequest = deferred<PlatformClinicRow[]>();
    mockedFetchClinics
      .mockImplementationOnce(() => staleRequest.promise)
      .mockResolvedValueOnce([clinic('clinic-new', 'New clinic')]);

    const { rerender } = render(<PlatformClinicsList />);
    await waitFor(() => expect(mockedFetchClinics).toHaveBeenCalledOnce());
    const staleSignal = mockedFetchClinics.mock.calls[0]?.[0];

    isPlatformAdmin = false;
    rerender(<PlatformClinicsList />);
    expect(await screen.findByText('Access denied. Platform admin only.')).toBeInTheDocument();
    expect(staleSignal?.aborted).toBe(true);

    isPlatformAdmin = true;
    rerender(<PlatformClinicsList />);
    expect(await screen.findByText('New clinic')).toBeInTheDocument();

    await act(async () => {
      staleRequest.resolve([clinic('clinic-old', 'Stale clinic')]);
      await staleRequest.promise;
    });

    expect(screen.queryByText('Stale clinic')).not.toBeInTheDocument();
    expect(screen.getByText('New clinic')).toBeInTheDocument();
  });

  it('keeps onboarding details lazy and cancels their request on navigation', async () => {
    mockedFetchClinics.mockResolvedValue([clinic('clinic-one', 'Clinic one')]);
    const onboardingRequest = deferred<{
      clinic: Record<string, unknown>;
      settings: null;
      checklist: Record<string, boolean>;
      languages: unknown[];
      subscription: null;
    }>();
    mockedFetchOnboarding.mockReturnValue(onboardingRequest.promise);

    const view = render(<PlatformClinicsList />);
    expect(await screen.findByText('Clinic one')).toBeInTheDocument();
    expect(mockedFetchOnboarding).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Onboarding' }));
    await waitFor(() => expect(mockedFetchOnboarding).toHaveBeenCalledOnce());
    const signal = mockedFetchOnboarding.mock.calls[0]?.[1];

    view.unmount();
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      onboardingRequest.resolve({
        clinic: {},
        settings: null,
        checklist: { clinic_details_done: true },
        languages: [],
        subscription: null,
      });
      await onboardingRequest.promise;
    });
  });

  it('aborts notification reads and prevents stale events after access context changes', async () => {
    const staleRequest = deferred<unknown[]>();
    mockedFetchNotifications
      .mockImplementationOnce(() => staleRequest.promise)
      .mockResolvedValueOnce([notification('notification-new', 'clinic-new')]);

    const { rerender } = render(<NotificationEventsList />);
    await waitFor(() => expect(mockedFetchNotifications).toHaveBeenCalledOnce());
    const staleSignal = mockedFetchNotifications.mock.calls[0]?.[0];

    isPlatformAdmin = false;
    rerender(<NotificationEventsList />);
    expect(await screen.findByText('Access denied. Platform admin only.')).toBeInTheDocument();
    expect(staleSignal?.aborted).toBe(true);

    isPlatformAdmin = true;
    rerender(<NotificationEventsList />);
    expect((await screen.findAllByText('clinic-new')).length).toBeGreaterThan(0);

    await act(async () => {
      staleRequest.resolve([notification('notification-old', 'clinic-old')]);
      await staleRequest.promise;
    });

    expect(screen.queryByText('clinic-old')).not.toBeInTheDocument();
    expect(screen.getAllByText('clinic-new').length).toBeGreaterThan(0);
  });

  it('aborts job-health reads and prevents stale runs after access context changes', async () => {
    const staleRequest = deferred<ReturnType<typeof jobHealth>>();
    mockedFetchJobHealth
      .mockImplementationOnce(() => staleRequest.promise)
      .mockResolvedValueOnce(jobHealth('NEW_JOB'));

    const { rerender } = render(<JobHealthDashboard />);
    await waitFor(() => expect(mockedFetchJobHealth).toHaveBeenCalledOnce());
    const staleSignal = mockedFetchJobHealth.mock.calls[0]?.[0];

    isPlatformAdmin = false;
    rerender(<JobHealthDashboard />);
    expect(await screen.findByText('Access denied. Platform admin only.')).toBeInTheDocument();
    expect(staleSignal?.aborted).toBe(true);

    isPlatformAdmin = true;
    rerender(<JobHealthDashboard />);
    expect(await screen.findByText('NEW_JOB')).toBeInTheDocument();

    await act(async () => {
      staleRequest.resolve(jobHealth('OLD_JOB'));
      await staleRequest.promise;
    });

    expect(screen.queryByText('OLD_JOB')).not.toBeInTheDocument();
    expect(screen.getByText('NEW_JOB')).toBeInTheDocument();
  });
});
