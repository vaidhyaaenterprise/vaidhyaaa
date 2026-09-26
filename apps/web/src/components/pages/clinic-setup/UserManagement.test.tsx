import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserManagement } from '@/components/pages/clinic-setup/UserManagement';
import { fetchDoctors } from '@/lib/api/clinic-clinical';
import {
  createClinicUserLogin,
  deleteClinicUserLogin,
  disableClinicUser,
  enableClinicUser,
  fetchClinicUsers,
  updateClinicUserLogin,
} from '@/lib/api/clinic-users';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const ADMIN_USER_ID = '00000000-0000-0000-0000-000000000101';
const ADMIN_MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000111';
const DOCTOR_USER_ID = '00000000-0000-0000-0000-000000000102';
const DOCTOR_MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000112';
const DOCTOR_ID = '00000000-0000-0000-0000-000000000201';
const UNLINKED_DOCTOR_ID = '00000000-0000-0000-0000-000000000202';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    effectiveRole: 'admin',
    me: {
      user: { id: ADMIN_USER_ID },
      clinics: [],
    },
  }),
}));

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => CLINIC_ID,
}));

vi.mock('@/lib/api/clinic-clinical', () => ({
  fetchDoctors: vi.fn(),
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
const mockedFetchClinicUsers = vi.mocked(fetchClinicUsers);
const mockedCreateClinicUserLogin = vi.mocked(createClinicUserLogin);
const mockedUpdateClinicUserLogin = vi.mocked(updateClinicUserLogin);
const mockedDeleteClinicUserLogin = vi.mocked(deleteClinicUserLogin);
const mockedDisableClinicUser = vi.mocked(disableClinicUser);
const mockedEnableClinicUser = vi.mocked(enableClinicUser);

function clinicUsersResponse() {
  return {
    clinic_login_number: '1003',
    users: [
      {
        id: ADMIN_MEMBERSHIP_ID,
        clinic_id: CLINIC_ID,
        user_id: ADMIN_USER_ID,
        role: 'clinic_admin' as const,
        doctor_id: null,
        active: true,
        user: {
          id: ADMIN_USER_ID,
          name: 'Merp Admin',
          email: 'merp@example.com',
          phone: null,
          username: 'merp.1003',
          active: true,
        },
      },
      {
        id: DOCTOR_MEMBERSHIP_ID,
        clinic_id: CLINIC_ID,
        user_id: DOCTOR_USER_ID,
        role: 'doctor' as const,
        doctor_id: DOCTOR_ID,
        active: true,
        user: {
          id: DOCTOR_USER_ID,
          name: 'Dr Existing',
          email: null,
          phone: null,
          username: 'existing.1003',
          active: true,
        },
      },
    ],
  };
}

beforeEach(() => {
  mockedFetchClinicUsers.mockReset().mockImplementation(async () => clinicUsersResponse());
  mockedFetchDoctors.mockReset().mockResolvedValue([
    {
      id: DOCTOR_ID,
      name: 'Dr Existing',
      qualification: 'MD',
      user_id: DOCTOR_USER_ID,
      active: true,
    },
    {
      id: UNLINKED_DOCTOR_ID,
      name: 'Dr Priya Kumar',
      qualification: 'MBBS',
      user_id: null,
      active: true,
    },
  ]);
  mockedCreateClinicUserLogin.mockReset().mockResolvedValue({
    user: { id: 'new-user', name: 'Dr Priya Kumar', username: 'priya.login.1003', active: true },
    membership: {},
  });
  mockedUpdateClinicUserLogin.mockReset().mockResolvedValue({
    user: { id: DOCTOR_USER_ID, name: 'Dr Existing', username: 'updated.1003', active: true },
    membership: {},
  });
  mockedDeleteClinicUserLogin.mockReset().mockResolvedValue({
    revoked: true,
    clinic_user_id: DOCTOR_MEMBERSHIP_ID,
    credentials_revoked: true,
  });
  mockedDisableClinicUser.mockReset().mockResolvedValue({ membership: {} });
  mockedEnableClinicUser.mockReset().mockResolvedValue({ membership: {} });
});

afterEach(() => cleanup());

describe('UserManagement', () => {
  it('lists existing doctor and admin logins in the management card', async () => {
    render(<UserManagement />);

    expect(await screen.findByText('Merp Admin')).toBeInTheDocument();
    expect(screen.getByText('Dr Existing')).toBeInTheDocument();
    expect(screen.getByText('merp.1003')).toBeInTheDocument();
    expect(screen.getByText('existing.1003')).toBeInTheDocument();
    expect(screen.getByText('#1003')).toBeInTheDocument();
    expect(mockedFetchClinicUsers).toHaveBeenCalledWith(CLINIC_ID);
    expect(mockedFetchDoctors).toHaveBeenCalledWith(CLINIC_ID);
  });

  it('creates a doctor login with an editable prefix, locked clinic suffix, and confirmation', async () => {
    render(<UserManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add login' }));

    const dialog = screen.getByRole('dialog', { name: 'Add a new login' });
    expect(within(dialog).getByRole('button', { name: 'Doctor' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.change(within(dialog).getByLabelText('Doctor'), {
      target: { value: UNLINKED_DOCTOR_ID },
    });
    expect(within(dialog).getByLabelText('Username')).toHaveValue('dr.priya.kumar');
    expect(within(dialog).getByText('.1003')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Username'), {
      target: { value: 'Priya Login' },
    });
    fireEvent.change(within(dialog).getByLabelText('Password'), {
      target: { value: 'secure123' },
    });
    fireEvent.change(within(dialog).getByLabelText('Confirm password'), {
      target: { value: 'secure123' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create login' }));

    await waitFor(() => {
      expect(mockedCreateClinicUserLogin).toHaveBeenCalledWith(CLINIC_ID, {
        role: 'doctor',
        login_name: 'priya.login',
        password: 'secure123',
        doctor_id: UNLINKED_DOCTOR_ID,
      });
    });
    expect(
      await screen.findByRole('dialog', { name: 'Login created successfully' }),
    ).toHaveTextContent('priya.login.1003');
    expect(screen.getByRole('dialog')).toHaveTextContent('secure123');
  });

  it('creates a clinic-admin login without a doctor association', async () => {
    render(<UserManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add login' }));

    const dialog = screen.getByRole('dialog', { name: 'Add a new login' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clinic admin' }));
    fireEvent.change(within(dialog).getByLabelText('Username'), {
      target: { value: 'Front Desk Admin' },
    });
    fireEvent.change(within(dialog).getByLabelText('Password'), {
      target: { value: 'secure123' },
    });
    fireEvent.change(within(dialog).getByLabelText('Confirm password'), {
      target: { value: 'secure123' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create login' }));

    await waitFor(() => {
      expect(mockedCreateClinicUserLogin).toHaveBeenCalledWith(CLINIC_ID, {
        role: 'clinic_admin',
        login_name: 'front.desk.admin',
        password: 'secure123',
      });
    });
  });

  it('traps dialog focus and restores it to Add login when closed', async () => {
    render(<UserManagement />);
    const addButton = await screen.findByRole('button', { name: 'Add login' });
    addButton.focus();
    fireEvent.click(addButton);

    const dialog = screen.getByRole('dialog', { name: 'Add a new login' });
    const closeButton = within(dialog).getByRole('button', { name: 'Close login dialog' });
    const cancelButton = within(dialog).getByRole('button', { name: 'Cancel' });

    cancelButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(addButton).toHaveFocus();
  });

  it('edits only changed credential fields and keeps the clinic suffix server-controlled', async () => {
    render(<UserManagement />);
    await screen.findByText('Dr Existing');
    fireEvent.click(screen.getByRole('button', { name: 'Edit credentials for existing.1003' }));

    const dialog = screen.getByRole('dialog', { name: 'Edit login credentials' });
    const usernameInput = within(dialog).getByLabelText('Username');
    expect(usernameInput).toHaveValue('existing');
    expect(within(dialog).getByText('.1003')).toBeInTheDocument();

    fireEvent.change(usernameInput, { target: { value: 'Doctor Updated' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mockedUpdateClinicUserLogin).toHaveBeenCalledWith(CLINIC_ID, DOCTOR_MEMBERSHIP_ID, {
        login_name: 'doctor.updated',
      });
    });
  });

  it('requires confirmation before revoking a doctor login', async () => {
    render(<UserManagement />);
    await screen.findByText('Dr Existing');
    fireEvent.click(screen.getByRole('button', { name: 'Delete login for existing.1003' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this login?' });
    expect(dialog).toHaveTextContent('doctor profile, appointments, and clinical history');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete login' }));

    await waitFor(() => {
      expect(mockedDeleteClinicUserLogin).toHaveBeenCalledWith(CLINIC_ID, DOCTOR_MEMBERSHIP_ID);
    });
  });
});
