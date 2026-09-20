import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClinicProfileProvider,
  useClinicProfile,
} from '@/components/clinic/ClinicProfileProvider';
import { ClinicSwitcher } from '@/components/layout/ClinicSwitcher';
import type { ClinicProfile } from '@/lib/api/clinic-settings';

const authMock = vi.hoisted(() => ({
  clinicId: '00000000-0000-0000-0000-000000000111' as string | null,
  status: 'authenticated',
}));

const clinicApiMock = vi.hoisted(() => ({
  fetchClinicProfile: vi.fn(),
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: authMock.status,
    clinicRole: authMock.clinicId
      ? {
          clinic_id: authMock.clinicId,
          role: 'clinic_admin',
          doctor_id: null,
          active: true,
        }
      : null,
  }),
}));

vi.mock('@/lib/api/clinic-settings', () => ({
  fetchClinicProfile: clinicApiMock.fetchClinicProfile,
}));

const HIGH_ON_LOVE: ClinicProfile = {
  name: 'High on love',
  clinic_unique_number: 1003,
  primary_phone: '9876543211',
  address_line1: 'Mettukuppam',
  address_line2: null,
  city: 'Chennai',
  state: 'Tamil Nadu',
  postal_code: '600097',
  country: 'India',
  timezone: 'Asia/Kolkata',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function ProfileProbe() {
  const { profile, status } = useClinicProfile();
  return <output>{profile?.name ?? status}</output>;
}

beforeEach(() => {
  authMock.clinicId = '00000000-0000-0000-0000-000000000111';
  authMock.status = 'authenticated';
  clinicApiMock.fetchClinicProfile.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ClinicProfileProvider', () => {
  it('never renders seed clinic data while the authenticated profile is loading', async () => {
    const request = deferred<ClinicProfile>();
    clinicApiMock.fetchClinicProfile.mockReturnValueOnce(request.promise);

    render(
      <ClinicProfileProvider>
        <ClinicSwitcher />
      </ClinicProfileProvider>,
    );

    expect(screen.getByText('Loading clinic…')).toBeInTheDocument();
    expect(screen.queryByText('Sri Murugan Clinic')).not.toBeInTheDocument();
    expect(screen.queryByText('High on love')).not.toBeInTheDocument();

    await act(async () => {
      request.resolve(HIGH_ON_LOVE);
      await request.promise;
    });

    expect(await screen.findByText('High on love')).toBeInTheDocument();
    expect(screen.getByText('#1003')).toBeInTheDocument();
    expect(screen.getByText('Mettukuppam, Chennai, Tamil Nadu, 600097')).toBeInTheDocument();
    expect(screen.getByText('Clinic line: 9876543211')).toBeInTheDocument();
    expect(screen.queryByText('Sri Murugan Clinic')).not.toBeInTheDocument();
  });

  it('keeps the loaded profile across route-level switcher remounts', async () => {
    clinicApiMock.fetchClinicProfile.mockResolvedValue(HIGH_ON_LOVE);

    const { rerender } = render(
      <ClinicProfileProvider>
        <ClinicSwitcher key="appointments" />
      </ClinicProfileProvider>,
    );

    expect(await screen.findByText('High on love')).toBeInTheDocument();

    rerender(
      <ClinicProfileProvider>
        <ClinicSwitcher key="settings" />
      </ClinicProfileProvider>,
    );

    expect(screen.getByText('High on love')).toBeInTheDocument();
    expect(screen.queryByText('Loading clinic…')).not.toBeInTheDocument();
    expect(clinicApiMock.fetchClinicProfile).toHaveBeenCalledOnce();
  });

  it('hides the previous tenant before loading a newly selected clinic', async () => {
    const nextClinicRequest = deferred<ClinicProfile>();
    const nextClinic: ClinicProfile = {
      ...HIGH_ON_LOVE,
      name: 'Second clinic',
      clinic_unique_number: 1004,
    };
    clinicApiMock.fetchClinicProfile
      .mockResolvedValueOnce(HIGH_ON_LOVE)
      .mockReturnValueOnce(nextClinicRequest.promise);

    const { rerender } = render(
      <ClinicProfileProvider>
        <ProfileProbe />
      </ClinicProfileProvider>,
    );

    expect(await screen.findByText('High on love')).toBeInTheDocument();

    authMock.clinicId = '00000000-0000-0000-0000-000000000222';
    rerender(
      <ClinicProfileProvider>
        <ProfileProbe />
      </ClinicProfileProvider>,
    );

    expect(screen.queryByText('High on love')).not.toBeInTheDocument();
    expect(screen.getByText('loading')).toBeInTheDocument();

    await act(async () => {
      nextClinicRequest.resolve(nextClinic);
      await nextClinicRequest.promise;
    });

    expect(await screen.findByText('Second clinic')).toBeInTheDocument();
    expect(screen.queryByText('High on love')).not.toBeInTheDocument();
  });

  it('shows a neutral error and retries without displaying seed data', async () => {
    clinicApiMock.fetchClinicProfile
      .mockRejectedValueOnce(new Error('network failure'))
      .mockResolvedValueOnce(HIGH_ON_LOVE);

    render(
      <ClinicProfileProvider>
        <ClinicSwitcher />
      </ClinicProfileProvider>,
    );

    expect(await screen.findByText('Clinic details unavailable')).toBeInTheDocument();
    expect(screen.getByText('Could not load clinic details.')).toBeInTheDocument();
    expect(screen.queryByText('Sri Murugan Clinic')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('High on love')).toBeInTheDocument());
    expect(clinicApiMock.fetchClinicProfile).toHaveBeenCalledTimes(2);
  });
});
