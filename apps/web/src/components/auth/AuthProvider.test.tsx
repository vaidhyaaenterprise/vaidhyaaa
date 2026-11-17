import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthProvider';
import { ApiRequestError, apiGet } from '@/lib/api/client';
import type { MeResponse } from '@/lib/api/types';
import {
  AUTH_TOKEN_STORAGE_KEY,
  DEV_AUTH_STORAGE_KEY,
  SHARED_AUTH_SESSION_STORAGE_KEY,
  type DevAuthProfile,
} from '@/lib/dev-auth/constants';
import {
  clearDevAuthProfile,
  readAccessToken,
  readDevAuthProfile,
  writeAuthSession,
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
          writeAuthSession('admin-token', ADMIN_PROFILE);
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

describe('AuthProvider browser-wide account verification', () => {
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
  it('never authenticates from a profile without a bearer credential', async () => {
    window.sessionStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify(ADMIN_PROFILE));
    renderSession();
    await expectStatus('unauthenticated');
    expect(apiGet).not.toHaveBeenCalled();
    expect(screen.getByTestId('auth-user')).toHaveTextContent('no user');
  });
  it('recovers a copied bearer credential only after the server validates the exact account', async () => {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'copied-doctor-token');
    const pending = deferred<MeResponse>();
    vi.mocked(apiGet).mockReturnValue(pending.promise);
    renderSession();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/v1/me', expect.any(AbortSignal)));
    expect(screen.getByTestId('auth-status')).toHaveTextContent('loading');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('no user');
    await act(async () => {
      pending.resolve(DOCTOR_SESSION);
      await pending.promise;
    });
    await expectStatus('authenticated');
    expect(screen.getByTestId('auth-role')).toHaveTextContent('doctor');
    expect(readDevAuthProfile()).toEqual(DOCTOR_PROFILE);
    expect(window.localStorage.getItem(SHARED_AUTH_SESSION_STORAGE_KEY)).toBeTruthy();
  });
  it('verifies and restores a shared session in a manually opened tab', async () => {
    writeAuthSession('admin-token', ADMIN_PROFILE);
    window.sessionStorage.clear();

    renderSession();

    await expectStatus('authenticated');
    expect(apiGet).toHaveBeenCalledWith('/v1/me', expect.any(AbortSignal));
    expect(screen.getByTestId('auth-user')).toHaveTextContent('Clinic Admin');
    expect(readAccessToken()).toBe('admin-token');
    expect(readDevAuthProfile()).toEqual(ADMIN_PROFILE);
  });
  it('publishes a pre-existing tab session only after server verification', async () => {
    seedSession(ADMIN_PROFILE, 'legacy-admin-token');
    expect(window.localStorage.getItem(SHARED_AUTH_SESSION_STORAGE_KEY)).toBeNull();

    renderSession();
    await expectStatus('authenticated');

    expect(window.localStorage.getItem(SHARED_AUTH_SESSION_STORAGE_KEY)).toBeTruthy();
    window.sessionStorage.clear();
    expect(readAccessToken()).toBe('legacy-admin-token');
    expect(readDevAuthProfile()).toEqual(ADMIN_PROFILE);
  });
  it('logs this tab out when another tab clears the shared browser session', async () => {
    writeAuthSession('admin-token', ADMIN_PROFILE);
    renderSession();
    await expectStatus('authenticated');

    window.localStorage.removeItem(SHARED_AUTH_SESSION_STORAGE_KEY);
    fireEvent(
      window,
      new StorageEvent('storage', {
        key: SHARED_AUTH_SESSION_STORAGE_KEY,
        oldValue: 'shared-session',
        newValue: null,
      }),
    );

    await expectStatus('unauthenticated');
    expect(readAccessToken()).toBeNull();
    expect(readDevAuthProfile()).toBeNull();
  });
  it('migrates a copied legacy tab from its verified token without trusting an outdated shared role', async () => {
    window.localStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify(ADMIN_PROFILE));
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'copied-token');
    vi.mocked(apiGet).mockResolvedValue(DOCTOR_SESSION);
    renderSession();
    await expectStatus('authenticated');
    expect(apiGet).toHaveBeenCalledWith('/v1/me', expect.any(AbortSignal));
    expect(screen.getByTestId('auth-user')).toHaveTextContent('Doctor');
    expect(screen.getByTestId('auth-role')).toHaveTextContent('doctor');
    expect(readDevAuthProfile()).toEqual(DOCTOR_PROFILE);
  });
  it('rejects an expired legacy credential instead of trusting its profile hint', async () => {
    window.localStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify(ADMIN_PROFILE));
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'expired-token');
    vi.mocked(apiGet).mockRejectedValue(
      new ApiRequestError({ code: 'UNAUTHORIZED', message: 'Session expired' }),
    );
    renderSession();
    await expectStatus('unauthenticated');
    expect(readAccessToken()).toBeNull();
    expect(readDevAuthProfile()).toBeNull();
  });
  it('does not choose the first membership when a copied token has ambiguous clinic access', async () => {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'legacy-multi-clinic-token');
    vi.mocked(apiGet).mockResolvedValue({
      ...DOCTOR_SESSION,
      clinics: [
        DOCTOR_SESSION.clinics[0]!,
        { ...DOCTOR_SESSION.clinics[0]!, clinic_id: '00000000-0000-0000-0000-000000000099' },
      ],
    });
    renderSession();
    await expectStatus('unauthenticated');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('no user');
    expect(readAccessToken()).toBeNull();
  });
  it('uses the server-verified token scope to recover the right clinic from multiple memberships', async () => {
    const anotherClinic = '00000000-0000-0000-0000-000000000099';
    const token = `${btoa(JSON.stringify({ sub: DOCTOR_USER_ID, clinicId: CLINIC_ID, clinicRole: 'doctor' }))}.test-signature`;
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    vi.mocked(apiGet).mockResolvedValue({
      ...DOCTOR_SESSION,
      clinics: [
        { ...DOCTOR_SESSION.clinics[0]!, clinic_id: anotherClinic },
        DOCTOR_SESSION.clinics[0]!,
      ],
    });
    renderSession();
    await expectStatus('authenticated');
    expect(readDevAuthProfile()).toEqual(DOCTOR_PROFILE);
  });
  it('keeps a missed shared logout signed out while a legacy /me request is pending', async () => {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'legacy-doctor-token');
    const pending = deferred<MeResponse>();
    vi.mocked(apiGet).mockReturnValue(pending.promise);
    renderSession();
    await waitFor(() => expect(apiGet).toHaveBeenCalledOnce());
    // Another document logged out; no synthetic storage event is delivered.
    window.localStorage.setItem(
      SHARED_AUTH_SESSION_STORAGE_KEY,
      JSON.stringify({ version: 1, signed_out: true }),
    );
    await act(async () => {
      pending.resolve(DOCTOR_SESSION);
      await pending.promise;
    });
    await expectStatus('unauthenticated');
    expect(readAccessToken()).toBeNull();
    expect(screen.getByTestId('auth-user')).toHaveTextContent('no user');
  });
  it('does not migrate a malformed copied profile as a valid legacy session', async () => {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'copied-token');
    window.sessionStorage.setItem(DEV_AUTH_STORAGE_KEY, '{malformed');
    renderSession();
    await expectStatus('unauthenticated');
    expect(apiGet).not.toHaveBeenCalled();
  });
  it('reconciles an account change missed during a suspended legacy verification', async () => {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'legacy-doctor-token');
    const pending = deferred<MeResponse>();
    vi.mocked(apiGet).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ADMIN_SESSION);
    renderSession();
    await waitFor(() => expect(apiGet).toHaveBeenCalledOnce());
    window.localStorage.setItem(
      SHARED_AUTH_SESSION_STORAGE_KEY,
      JSON.stringify({ version: 1, token: 'admin-token', profile: ADMIN_PROFILE }),
    );
    await act(async () => {
      pending.resolve(DOCTOR_SESSION);
      await pending.promise;
    });
    await expectStatus('authenticated');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('Clinic Admin');
    expect(readDevAuthProfile()).toEqual(ADMIN_PROFILE);
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
  it('revalidates a BFCache-restored page after the shared browser session was cleared', async () => {
    seedSession();
    renderSession();
    await expectStatus('authenticated');
    window.localStorage.removeItem(SHARED_AUTH_SESSION_STORAGE_KEY);
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
