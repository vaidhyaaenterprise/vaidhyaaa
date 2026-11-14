import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LoginPage from './page';

import { loginWithUsernamePassword } from '@/lib/api/auth';
import { readAccessToken, readDevAuthProfile } from '@/lib/dev-auth/storage';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  establishSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => mocks }));
vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'unauthenticated', establishSession: mocks.establishSession }),
}));
vi.mock('@/components/auth/ForgotPasswordFlow', () => ({ ForgotPasswordFlow: () => null }));
vi.mock('@/components/auth/RegisterClinicForm', () => ({ RegisterClinicForm: () => null }));
vi.mock('@/lib/api/auth', () => ({ loginWithUsernamePassword: vi.fn() }));

const admin = {
  clinic_id: '00000000-0000-4000-8000-000000000301',
  role: 'clinic_admin' as const,
  doctor_id: null,
  active: true,
};
const doctor = {
  ...admin,
  role: 'doctor' as const,
  doctor_id: '00000000-0000-4000-8000-000000000401',
};
const user = {
  id: '00000000-0000-4000-8000-000000000101',
  name: 'Shared Login',
  email: 'shared@example.test',
  phone: null,
  platform_role: null,
  active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loginWithUsernamePassword).mockResolvedValue({
    access_token: 'test-token',
    user,
    clinics: [admin, doctor],
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function enterCredentials(submitWith: 'button' | 'form' = 'button') {
  fireEvent.change(screen.getByPlaceholderText('Email Address'), { target: { value: user.email } });
  fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test-password' } });
  if (submitWith === 'form') {
    // Browsers submit this same form when Enter is pressed in either credential field.
    fireEvent.submit(screen.getByRole('form', { name: 'Sign in' }));
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  }
}

describe('role-specific sign-in', () => {
  it.each([
    ['doctor', 'button'],
    ['clinic_admin', 'button'],
    ['doctor', 'form'],
    ['clinic_admin', 'form'],
  ] as const)(
    'sends the selected %s role using %s submission and hydrates only the matching membership',
    async (role, submitWith) => {
      render(<LoginPage />);
      fireEvent.click(
        screen.getByRole('button', {
          name: role === 'doctor' ? 'Doctor' : 'Clinic Admin',
        }),
      );
      enterCredentials(submitWith);

      await waitFor(() =>
        expect(mocks.establishSession).toHaveBeenCalledWith({
          user,
          clinics: [role === 'doctor' ? doctor : admin],
        }),
      );
      expect(loginWithUsernamePassword).toHaveBeenCalledWith(user.email, 'test-password', role);
      expect(readDevAuthProfile()).toMatchObject({ role, userId: user.id });
      expect(readAccessToken()).toBe('test-token');
      expect(mocks.replace).toHaveBeenCalledWith('/');
    },
  );

  it('does not establish an admin session if doctor login returns only admin access', async () => {
    vi.mocked(loginWithUsernamePassword).mockResolvedValue({
      access_token: 'admin-token',
      user,
      clinics: [admin],
    });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Doctor' }));
    enterCredentials();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('no active doctor access'),
    );
    expect(mocks.establishSession).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(readAccessToken()).toBeNull();
  });
});
