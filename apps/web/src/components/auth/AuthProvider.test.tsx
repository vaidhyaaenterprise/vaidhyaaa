import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthProvider';
import { ApiRequestError, apiGet } from '@/lib/api/client';
import type { MeResponse } from '@/lib/api/types';
import {
  AUTH_TOKEN_STORAGE_KEY,
  DEV_AUTH_STORAGE_KEY,
  type DevAuthProfile,
} from '@/lib/dev-auth/constants';
import {
  clearDevAuthProfile,
  readAccessToken,
  readDevAuthProfile,
  writeAccessToken,
  writeDevAuthProfile,
} from '@/lib/dev-auth/storage';

vi.mock('@/lib/dev-auth/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dev-auth/storage')>()),
  initializeTabSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiGet: vi.fn(),
}));
const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const ADMIN_ID = '00000000-0000-0000-0000-000000000101';
const DOCTOR_USER_ID = '00000000-0000-0000-0000-000000000102';
const DOCTOR_ID = '00000000-0000-0000-0000-000000000201';
const ADMIN_PROFILE: DevAuthProfile = {
  userId: ADMIN_ID,
  role: 'clinic_admin',
  clinicId: CLINIC_ID,
};
const DOCTOR_PROFILE: DevAuthProfile = {
  userId: DOCTOR_USER_ID,
  role: 'doctor',
  clinicId: CLINIC_ID,
  doctorId: DOCTOR_ID,
};
const ADMIN_SESSION: MeResponse = {
  user: {
    id: ADMIN_ID,
    name: 'Clinic Admin',
    email: 'admin@example.test',
    phone: null,
    platform_role: null,
    active: true,
  },
  clinics: [{ clinic_id: CLINIC_ID, role: 'clinic_admin', doctor_id: null, active: true }],
};
const DOCTOR_SESSION: MeResponse = {
  user: { ...ADMIN_SESSION.user, id: DOCTOR_USER_ID, name: 'Doctor' },
  clinics: [{ clinic_id: CLINIC_ID, role: 'doctor', doctor_id: DOCTOR_ID, active: true }],
};
function seedSession(profile = ADMIN_PROFILE, token = 'admin-token') {
  window.sessionStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify(profile));
  window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function SessionProbe() {
  const { status, me, effectiveRole, clinicRole, error, establishSession, refresh } = useAuth();
  return (
    <div>
      <span data-testid="auth-status">{status}</span>
      <span data-testid="auth-user">{me?.user.name ?? 'no user'}</span>
      <span data-testid="auth-role">{effectiveRole}</span>
      <span data-testid="auth-doctor">{clinicRole?.doctor_id ?? 'no doctor'}</span>
      <span data-testid="auth-error">{error ?? 'no error'}</span>
      <button
        type="button"
        onClick={() => {
          writeAccessToken('admin-token');
          writeDevAuthProfile(ADMIN_PROFILE);
          establishSession(ADMIN_SESSION);
        }}
      >
        Establish session
      </button>
      <button
        type="button"
        onClick={() => {
          clearDevAuthProfile();
          void refresh();
        }}
      >
        Log out
      </button>
    </div>
  );
}
function renderSession() {
  return render(
    <AuthProvider>
      <SessionProbe />
    </AuthProvider>,
  );
}
async function expectStatus(status: string) {
  await waitFor(() => expect(screen.getByTestId('auth-status').textContent).toBe(status));
}
beforeEach(() => {
  vi.mocked(apiGet).mockReset().mockResolvedValue(ADMIN_SESSION);
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('AuthProvider tab-scoped account verification', () => {
  it('hydrates a newly signed-in session without a duplicate /me request', async () => {
    renderSession();
    await expectStatus('unauthenticated');
    fireEvent.click(screen.getByRole('button', { name: 'Establish session' }));
    await expectStatus('authenticated');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('Clinic Admin');
    expect(apiGet).not.toHaveBeenCalled();
    expect(readAccessToken()).toBe('admin-token');
    expect(readDevAuthProfile()).toEqual(ADMIN_PROFILE);
  });
  it.each(['profile', 'token'] as const)(
    'requires both credentials rather than %s alone',
    async (only) => {
      if (only === 'profile')
        window.sessionStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify(ADMIN_PROFILE));
      else window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'orphan-token');
      renderSession();
      await expectStatus('unauthenticated');
      expect(apiGet).not.toHaveBeenCalled();
      expect(screen.getByTestId('auth-user')).toHaveTextContent('no user');
    },
  );
  it('ignores a legacy shared profile even when an access token remains in this tab', async () => {
    window.localStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify(ADMIN_PROFILE));
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'copied-token');
    renderSession();
    await expectStatus('unauthenticated');
    expect(apiGet).not.toHaveBeenCalled();
  });
  it('selects the exact doctor membership even when an admin membership appears first', async () => {
    seedSession(DOCTOR_PROFILE, 'doctor-token');
    vi.mocked(apiGet).mockResolvedValue({
      ...DOCTOR_SESSION,
      clinics: [...ADMIN_SESSION.clinics, ...DOCTOR_SESSION.clinics],
    });
    renderSession();
    await expectStatus('authenticated');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('Doctor');
    expect(screen.getByTestId('auth-role')).toHaveTextContent('doctor');
    expect(screen.getByTestId('auth-doctor')).toHaveTextContent(DOCTOR_ID);
  });
  it.each([
    { label: 'different user', response: ADMIN_SESSION },
    {
      label: 'missing requested role',
      response: { ...DOCTOR_SESSION, clinics: ADMIN_SESSION.clinics },
    },
    {
      label: 'different doctor',
      response: {
        ...DOCTOR_SESSION,
        clinics: [{ ...DOCTOR_SESSION.clinics[0]!, doctor_id: 'other-doctor' }],
      },
    },
    {
      label: 'different clinic',
      response: {
        ...DOCTOR_SESSION,
        clinics: [{ ...DOCTOR_SESSION.clinics[0]!, clinic_id: 'other-clinic' }],
      },
    },
    {
      label: 'unexpected platform role',
      response: {
        ...DOCTOR_SESSION,
        user: { ...DOCTOR_SESSION.user, platform_role: 'platform_admin' },
      },
    },
  ])('fails closed for $label', async ({ response }) => {
    seedSession(DOCTOR_PROFILE, 'doctor-token');
    vi.mocked(apiGet).mockResolvedValue(response);
    renderSession();
    await expectStatus('unauthenticated');
    expect(readAccessToken()).toBeNull();
    expect(readDevAuthProfile()).toBeNull();
    expect(screen.getByTestId('auth-user')).toHaveTextContent('no user');
  });
  it('does not authenticate from local hints after an API failure', async () => {
    seedSession();
    vi.mocked(apiGet).mockRejectedValue(
      new ApiRequestError({ code: 'INTERNAL_ERROR', message: 'API unavailable' }),
    );
    renderSession();
    await expectStatus('error');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('no user');
    expect(screen.getByTestId('auth-error')).toHaveTextContent('API unavailable');
  });
  it('does not restore an old /me success after logout', async () => {
    seedSession(DOCTOR_PROFILE, 'doctor-token');
    const pending = deferred<MeResponse>();
    vi.mocked(apiGet).mockReturnValue(pending.promise);
    renderSession();
    await waitFor(() => expect(apiGet).toHaveBeenCalledOnce());
    const signal = vi.mocked(apiGet).mock.calls[0]?.[1];
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await expectStatus('unauthenticated');
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(DOCTOR_SESSION);
      await pending.promise;
    });
    await expectStatus('unauthenticated');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('no user');
    expect(readAccessToken()).toBeNull();
  });
  it('does not let an old unauthorized response clear a new login', async () => {
    seedSession(DOCTOR_PROFILE, 'doctor-token');
    const pending = deferred<MeResponse>();
    vi.mocked(apiGet).mockReturnValue(pending.promise);
    renderSession();
    await waitFor(() => expect(apiGet).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Establish session' }));
    await expectStatus('authenticated');
    await act(async () => {
      pending.reject(new ApiRequestError({ code: 'UNAUTHORIZED', message: 'Old token expired' }));
      await pending.promise.catch(() => undefined);
    });
    await expectStatus('authenticated');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('Clinic Admin');
    expect(readAccessToken()).toBe('admin-token');
    expect(apiGet).toHaveBeenCalledOnce();
  });
  it('revalidates a BFCache-restored page instead of retaining an old authenticated view', async () => {
    seedSession();
    renderSession();
    await expectStatus('authenticated');
    window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    fireEvent(window, event);
    await expectStatus('unauthenticated');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('no user');
  });

  it('checks the server again on BFCache restoration even when saved credentials are unchanged', async () => {
    seedSession();
    vi.mocked(apiGet)
      .mockResolvedValueOnce(ADMIN_SESSION)
      .mockRejectedValueOnce(
        new ApiRequestError({ code: 'UNAUTHORIZED', message: 'Session expired while away' }),
      );
    renderSession();
    await expectStatus('authenticated');
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    fireEvent(window, event);
    await expectStatus('unauthenticated');
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(readAccessToken()).toBeNull();
  });
});
