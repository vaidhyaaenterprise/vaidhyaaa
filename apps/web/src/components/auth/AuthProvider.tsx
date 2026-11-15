'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiRequestError, apiGet, isAbortError } from '@/lib/api/client';
import type { MeResponse } from '@/lib/api/types';
import type { DevAuthProfile } from '@/lib/dev-auth/constants';
import {
  AUTH_SESSION_CHANGED_EVENT,
  clearDevAuthProfile,
  getAuthSessionVersion,
  initializeTabSession,
  readAccessToken,
  readDevAuthProfile,
} from '@/lib/dev-auth/storage';
import { resolveEffectiveRole, type EffectiveRole } from '@/lib/navigation';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'inactive' | 'error';
type AuthContextValue = {
  status: AuthStatus;
  me: MeResponse | null;
  effectiveRole: EffectiveRole;
  clinicRole: MeResponse['clinics'][number] | null;
  error: string | null;
  errorCode: string | null;
  refresh: () => Promise<void>;
  establishSession: (session: MeResponse) => void;
};
const AuthContext = createContext<AuthContextValue | null>(null);
function selectedMembership(session: MeResponse, profile: DevAuthProfile) {
  return (
    session.clinics.find(
      (row) =>
        row.active &&
        row.clinic_id === profile.clinicId &&
        row.role === profile.role &&
        (row.role !== 'doctor' || Boolean(profile.doctorId && row.doctor_id === profile.doctorId)),
    ) ?? null
  );
}
function matchesAccount(session: MeResponse, profile: DevAuthProfile): boolean {
  if (session.user.id !== profile.userId) return false;
  if (profile.role === 'platform_admin') return session.user.platform_role === 'platform_admin';
  return !session.user.platform_role && Boolean(selectedMembership(session, profile));
}
function sessionIdentity(): string {
  return JSON.stringify([getAuthSessionVersion(), readAccessToken(), readDevAuthProfile()]);
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [profile, setProfile] = useState<DevAuthProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const sequenceRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const identityRef = useRef('');
  const invalidateRequest = useCallback(() => {
    sequenceRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);
  const loadMe = useCallback(async () => {
    invalidateRequest();
    const sequence = sequenceRef.current;
    setStatus('loading');
    setMe(null);
    setProfile(null);
    setError(null);
    setErrorCode(null);
    await initializeTabSession();
    if (!mountedRef.current || sequence !== sequenceRef.current) return;
    const savedProfile = readDevAuthProfile();
    const token = readAccessToken();
    const identity = sessionIdentity();
    identityRef.current = identity;
    if (!savedProfile || !token) {
      setStatus('unauthenticated');
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    const isCurrent = () =>
      mountedRef.current &&
      !controller.signal.aborted &&
      sequenceRef.current === sequence &&
      sessionIdentity() === identity;
    try {
      const response = await apiGet<MeResponse>('/v1/me', controller.signal);
      if (!isCurrent()) return;
      if (!matchesAccount(response, savedProfile)) {
        clearDevAuthProfile();
        return;
      }
      setMe(response);
      setProfile(savedProfile);
      setStatus(response.user.active ? 'authenticated' : 'inactive');
    } catch (err) {
      if (!isCurrent() || isAbortError(err)) return;
      if (err instanceof ApiRequestError) {
        if (err.apiError.code === 'UNAUTHORIZED' || err.apiError.code === 'FORBIDDEN') {
          clearDevAuthProfile();
          return;
        }
        setError(err.apiError.message);
        setErrorCode(err.apiError.code);
      } else {
        setError('Unable to reach the API. Please check your connection and try again.');
        setErrorCode('INTERNAL_ERROR');
      }
      // Never invent a logged-in user from local hints after a failed identity check.
      setStatus('error');
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [invalidateRequest]);
  const establishSession = useCallback(
    (session: MeResponse) => {
      invalidateRequest();
      const savedProfile = readDevAuthProfile();
      if (!savedProfile || !readAccessToken() || !matchesAccount(session, savedProfile)) {
        clearDevAuthProfile();
        throw new Error('The login session does not match this account. Please sign in again.');
      }
      identityRef.current = sessionIdentity();
      setMe(session);
      setProfile(savedProfile);
      setError(null);
      setErrorCode(null);
      setStatus(session.user.active ? 'authenticated' : 'inactive');
    },
    [invalidateRequest],
  );
  useEffect(() => {
    mountedRef.current = true;
    const onChange = () => {
      void loadMe();
    };
    const onPageHide = () => {
      invalidateRequest();
      setMe(null);
      setProfile(null);
      setStatus('loading');
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void loadMe();
    };
    const onFocus = () => {
      if (sessionIdentity() !== identityRef.current) void loadMe();
    };
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, onChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    void loadMe();
    return () => {
      mountedRef.current = false;
      invalidateRequest();
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, onChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadMe, invalidateRequest]);
  const clinicRole = useMemo(
    () => (me && profile ? selectedMembership(me, profile) : null),
    [me, profile],
  );
  const effectiveRole = useMemo(
    () =>
      resolveEffectiveRole({
        platformRole: me?.user.platform_role ?? null,
        clinicRole: clinicRole?.role ?? null,
      }),
    [me, clinicRole],
  );
  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      effectiveRole,
      clinicRole,
      error,
      errorCode,
      refresh: loadMe,
      establishSession,
    }),
    [status, me, effectiveRole, clinicRole, error, errorCode, loadMe, establishSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
