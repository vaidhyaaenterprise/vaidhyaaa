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

import { ApiRequestError, apiGet } from '@/lib/api/client';
import type { MeResponse } from '@/lib/api/types';
import { DEV_SEED, type DevAuthProfile } from '@/lib/dev-auth/constants';
import { clearDevAuthProfile, readDevAuthProfile } from '@/lib/dev-auth/storage';
import {
  resolveEffectiveRole,
  type EffectiveRole,
} from '@/lib/navigation';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'inactive' | 'error';

type AuthContextValue = {
  status: AuthStatus;
  me: MeResponse | null;
  effectiveRole: EffectiveRole;
  clinicRole: MeResponse['clinics'][number] | null;
  error: string | null;
  errorCode: string | null;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function buildDevMockMe(profile: DevAuthProfile): MeResponse {
  const identityMap: Record<string, { name: string; email: string; phone: string }> = {
    [DEV_SEED.PLATFORM_ADMIN_ID]: {
      name: 'Platform Admin',
      email: 'platform@vaidya.local',
      phone: '+910000000001',
    },
    [DEV_SEED.CLINIC_ADMIN_ID]: {
      name: 'Clinic Admin',
      email: 'admin@sri-murugan.local',
      phone: '+919840012345',
    },
    [DEV_SEED.DOCTOR_PRIYA_USER_ID]: {
      name: 'Dr. Priya Login',
      email: 'priya@sri-murugan.local',
      phone: '+919840012346',
    },
  };

  const identity = identityMap[profile.userId] ?? {
    name: 'Dev User',
    email: 'dev@vaidya.local',
    phone: '+910000000000',
  };

  const clinics: MeResponse['clinics'] = profile.clinicId
    ? [
        {
          clinic_id: profile.clinicId,
          role: profile.role === 'doctor' ? 'doctor' : 'clinic_admin',
          doctor_id: profile.doctorId ?? null,
          active: true,
        },
      ]
    : [];

  return {
    user: {
      id: profile.userId,
      name: identity.name,
      email: identity.email,
      phone: identity.phone,
      platform_role: profile.role === 'platform_admin' ? 'platform_admin' : null,
      active: true,
    },
    clinics,
  };
}

let inflightMeRequest: Promise<MeResponse> | null = null;

async function fetchMeOnce(): Promise<MeResponse> {
  if (!inflightMeRequest) {
    inflightMeRequest = apiGet<MeResponse>('/v1/me').finally(() => {
      inflightMeRequest = null;
    });
  }
  return inflightMeRequest;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const loadMe = useCallback(async () => {
    const profile = readDevAuthProfile();
    if (!profile) {
      setMe(null);
      setError(null);
      setErrorCode(null);
      setStatus('unauthenticated');
      return;
    }

    setStatus('loading');
    setError(null);
    setErrorCode(null);

    try {
      const response = await fetchMeOnce();
      if (!mountedRef.current) {
        return;
      }

      if (!response.user.active) {
        setMe(response);
        setStatus('inactive');
        return;
      }

      setMe(response);
      setStatus('authenticated');
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }

      if (err instanceof ApiRequestError) {
        setError(err.apiError.message);
        setErrorCode(err.apiError.code);
        if (err.apiError.code === 'UNAUTHORIZED' || err.apiError.code === 'FORBIDDEN') {
          clearDevAuthProfile();
          setMe(null);
          setStatus('unauthenticated');
          return;
        }

        if (profile && err.apiError.code === 'INTERNAL_ERROR') {
          setMe(buildDevMockMe(profile));
          setError(null);
          setErrorCode(null);
          setStatus('authenticated');
          return;
        }
      } else {
        if (profile) {
          setMe(buildDevMockMe(profile));
          setError(null);
          setErrorCode(null);
          setStatus('authenticated');
          return;
        }
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to reach the API. Check NEXT_PUBLIC_API_BASE_URL and server status.',
        );
        setErrorCode('INTERNAL_ERROR');
      }
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadMe();
    return () => {
      mountedRef.current = false;
    };
  }, [loadMe]);

  const clinicRole = useMemo(() => {
    if (!me) {
      return null;
    }
    const profile = readDevAuthProfile();
    if (profile?.clinicId) {
      return me.clinics.find((row) => row.clinic_id === profile.clinicId) ?? me.clinics[0] ?? null;
    }
    return me.clinics[0] ?? null;
  }, [me]);

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
    }),
    [status, me, effectiveRole, clinicRole, error, errorCode, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
