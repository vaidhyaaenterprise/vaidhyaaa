import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClinicProfileProvider, useClinicProfile } from '@/components/clinic/ClinicProfileProvider';
import { ClinicSwitcher } from '@/components/layout/ClinicSwitcher';
import type { ClinicProfile } from '@/lib/api/clinic-settings';

const authMock = vi.hoisted(() => ({
  clinicId: '00000000-0000-0000-0000-000000000111' as string | null,
  status: 'authenticated',
  clinicRole: 'clinic_admin' as 'clinic_admin' | 'doctor',
  platformRole: null as 'platform_admin' | null,
}));

const clinicApiMock = vi.hoisted(() => ({
  fetchClinicProfile: vi.fn(),
  patchClinicProfile: vi.fn(),
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: authMock.status,
    me: {
      user: {
        platform_role: authMock.platformRole,
      },
    },
    clinicRole: authMock.clinicId
      ? {
          clinic_id: authMock.clinicId,
          role: authMock.clinicRole,
          doctor_id: null,
          active: true,
        }
      : null,
  }),
}));

vi.mock('@/lib/api/clinic-settings', () => ({
  fetchClinicProfile: clinicApiMock.fetchClinicProfile,
  patchClinicProfile: clinicApiMock.patchClinicProfile,
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

const UPDATED_CLINIC: ClinicProfile = {
  ...HIGH_ON_LOVE,
  name: 'High on care',
  primary_phone: '+91 90000 00000',
  address_line1: '42 Clinic Road',
  address_line2: null,
  city: 'Coimbatore',
  postal_code: '641001',
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
  authMock.clinicRole = 'clinic_admin';
  authMock.platformRole = null;
  clinicApiMock.fetchClinicProfile.mockReset();
  clinicApiMock.patchClinicProfile.mockReset();
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

  it('opens an admin-only edit dialog without exposing the clinic identifier and cancels cleanly', async () => {
    clinicApiMock.fetchClinicProfile.mockResolvedValue(HIGH_ON_LOVE);

    render(
      <ClinicProfileProvider>
        <ClinicSwitcher />
      </ClinicProfileProvider>,
    );

    expect(await screen.findByText('High on love')).toBeInTheDocument();
    expect(screen.getByText('#1003')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit clinic details' }));

    const dialog = screen.getByRole('dialog', { name: 'Edit clinic details' });
    expect(within(dialog).getByRole('textbox', { name: 'Clinic name' })).toHaveValue(
      'High on love',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Phone number' })).toHaveValue('9876543211');
    expect(within(dialog).getByRole('textbox', { name: 'Address line 1' })).toHaveValue(
      'Mettukuppam',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Address line 2' })).toHaveValue('');
    expect(within(dialog).getByRole('textbox', { name: 'City' })).toHaveValue('Chennai');
    expect(within(dialog).getByRole('textbox', { name: 'State' })).toHaveValue('Tamil Nadu');
    expect(within(dialog).getByRole('textbox', { name: 'Postal code' })).toHaveValue('600097');
    expect(within(dialog).getByRole('textbox', { name: 'Country' })).toHaveValue('India');
    expect(
      within(dialog).queryByLabelText(/clinic (?:id|number|unique number)/i),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByDisplayValue('1003')).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Clinic name' }), {
      target: { value: 'Discarded clinic name' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Edit clinic details' })).not.toBeInTheDocument();
    expect(screen.getByText('High on love')).toBeInTheDocument();
    expect(screen.getByText('#1003')).toBeInTheDocument();
    expect(clinicApiMock.patchClinicProfile).not.toHaveBeenCalled();
  });

  it('hides the clinic edit control from doctors', async () => {
    authMock.clinicRole = 'doctor';
    clinicApiMock.fetchClinicProfile.mockResolvedValue(HIGH_ON_LOVE);

    render(
      <ClinicProfileProvider>
        <ClinicSwitcher />
      </ClinicProfileProvider>,
    );

    expect(await screen.findByText('High on love')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit clinic details' })).not.toBeInTheDocument();
  });

  it('saves editable profile fields and updates provider state without refetching', async () => {
    clinicApiMock.fetchClinicProfile.mockResolvedValue(HIGH_ON_LOVE);
    clinicApiMock.patchClinicProfile.mockResolvedValue(UPDATED_CLINIC);

    render(
      <ClinicProfileProvider>
        <ClinicSwitcher />
      </ClinicProfileProvider>,
    );

    expect(await screen.findByText('High on love')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit clinic details' }));

    const dialog = screen.getByRole('dialog', { name: 'Edit clinic details' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Clinic name' }), {
      target: { value: '  High on care  ' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Phone number' }), {
      target: { value: '  +91 90000 00000  ' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Address line 1' }), {
      target: { value: '  42 Clinic Road  ' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Address line 2' }), {
      target: { value: '   ' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'City' }), {
      target: { value: '  Coimbatore  ' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'State' }), {
      target: { value: '  Tamil Nadu  ' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Postal code' }), {
      target: { value: '  641001  ' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Country' }), {
      target: { value: '  India  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(clinicApiMock.patchClinicProfile).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000111',
        {
          name: 'High on care',
          primary_phone: '+91 90000 00000',
          address_line1: '42 Clinic Road',
          address_line2: null,
          city: 'Coimbatore',
          state: 'Tamil Nadu',
          postal_code: '641001',
          country: 'India',
        },
      );
    });
    expect(await screen.findByText('High on care')).toBeInTheDocument();
    expect(screen.getByText('42 Clinic Road, Coimbatore, Tamil Nadu, 641001')).toBeInTheDocument();
    expect(screen.getByText('Clinic line: +91 90000 00000')).toBeInTheDocument();
    expect(screen.getByText('#1003')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Edit clinic details' })).not.toBeInTheDocument();
    expect(clinicApiMock.fetchClinicProfile).toHaveBeenCalledOnce();
  });

  it('keeps unsaved values in the dialog and preserves the ready profile when saving fails', async () => {
    clinicApiMock.fetchClinicProfile.mockResolvedValue(HIGH_ON_LOVE);
    clinicApiMock.patchClinicProfile.mockRejectedValue(new Error('Clinic update failed.'));

    render(
      <ClinicProfileProvider>
        <ClinicSwitcher />
      </ClinicProfileProvider>,
    );

    expect(await screen.findByText('High on love')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit clinic details' }));

    const dialog = screen.getByRole('dialog', { name: 'Edit clinic details' });
    const nameInput = within(dialog).getByRole('textbox', { name: 'Clinic name' });
    fireEvent.change(nameInput, { target: { value: 'Still in the form' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Clinic update failed.');
    expect(nameInput).toHaveValue('Still in the form');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByText('High on love')).toBeInTheDocument();
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
