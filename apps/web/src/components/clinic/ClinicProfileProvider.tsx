'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import {
  fetchClinicProfile,
  patchClinicProfile,
  type ClinicProfile,
  type ClinicProfilePatch,
} from '@/lib/api/clinic-settings';

export type ClinicProfileStatus = 'idle' | 'loading' | 'ready' | 'error';

type ClinicProfileContextValue = {
  clinicId: string | null;
  profile: ClinicProfile | null;
  status: ClinicProfileStatus;
  refresh: () => void;
  updateProfile: (patch: ClinicProfilePatch) => Promise<void>;
};

type ClinicProfileState = {
  clinicId: string | null;
  profile: ClinicProfile | null;
  status: ClinicProfileStatus;
};

const INITIAL_STATE: ClinicProfileState = {
  clinicId: null,
  profile: null,
  status: 'idle',
};

const ClinicProfileContext = createContext<ClinicProfileContextValue | null>(null);

export function ClinicProfileProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, clinicRole } = useAuth();
  const clinicId = authStatus === 'authenticated' ? (clinicRole?.clinic_id ?? null) : null;
  const [state, setState] = useState<ClinicProfileState>(INITIAL_STATE);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const refresh = useCallback(() => {
    setRefreshVersion((version) => version + 1);
  }, []);

  const updateProfile = useCallback(
    async (patch: ClinicProfilePatch) => {
      if (!clinicId) {
        throw new Error('No active clinic is selected.');
      }

      const targetClinicId = clinicId;
      const updatedProfile = await patchClinicProfile(targetClinicId, patch);

      // A clinic switch can happen while the request is in flight. Never let a
      // response for the previous tenant replace the newly selected profile.
      setState((current) =>
        current.clinicId === targetClinicId
          ? { clinicId: targetClinicId, profile: updatedProfile, status: 'ready' }
          : current,
      );
    },
    [clinicId],
  );

  useEffect(() => {
    let cancelled = false;

    if (!clinicId) {
      setState(INITIAL_STATE);
      return () => {
        cancelled = true;
      };
    }

    setState({ clinicId, profile: null, status: 'loading' });

    void fetchClinicProfile(clinicId)
      .then((profile) => {
        if (!cancelled) {
          setState({ clinicId, profile, status: 'ready' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ clinicId, profile: null, status: 'error' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clinicId, refreshVersion]);

  const value = useMemo<ClinicProfileContextValue>(() => {
    if (!clinicId) {
      return {
        clinicId: null,
        profile: null,
        status: 'idle',
        refresh,
        updateProfile,
      };
    }

    // State updates run after render. Guarding by clinic ID prevents the previous
    // tenant's profile from appearing for even one frame when membership changes.
    if (state.clinicId !== clinicId) {
      return {
        clinicId,
        profile: null,
        status: 'loading',
        refresh,
        updateProfile,
      };
    }

    return {
      clinicId,
      profile: state.status === 'ready' ? state.profile : null,
      status: state.status,
      refresh,
      updateProfile,
    };
  }, [clinicId, refresh, state, updateProfile]);

  return <ClinicProfileContext.Provider value={value}>{children}</ClinicProfileContext.Provider>;
}

export function useClinicProfile(): ClinicProfileContextValue {
  const context = useContext(ClinicProfileContext);
  if (!context) {
    throw new Error('useClinicProfile must be used within ClinicProfileProvider');
  }
  return context;
}
