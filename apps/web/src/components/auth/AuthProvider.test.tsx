import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '@/components/auth/AuthProvider';
import type { MeResponse } from '@/lib/api/types';

const LOGIN_SESSION: MeResponse = {
  user: {
    id: '00000000-0000-0000-0000-000000000101',
    name: 'Clinic Admin',
    email: 'admin@example.test',
    phone: null,
    platform_role: null,
    active: true,
  },
  clinics: [
    {
      clinic_id: '00000000-0000-0000-0000-000000000001',
      role: 'clinic_admin',
      doctor_id: null,
      active: true,
    },
  ],
};

function SessionProbe() {
  const { status, me, establishSession } = useAuth();
  return (
    <div>
      <span>{status}</span>
      <span>{me?.user.name ?? 'no user'}</span>
      <button type="button" onClick={() => establishSession(LOGIN_SESSION)}>
        Establish session
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('AuthProvider', () => {
  it('hydrates an authenticated session without a duplicate /me request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <SessionProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Establish session' }));

    expect(screen.getByText('authenticated')).toBeInTheDocument();
    expect(screen.getByText('Clinic Admin')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
