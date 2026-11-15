'use client';

import { useAuth } from '@/components/auth/AuthProvider';

export function useActiveClinicId(): string | null {
  const { status, clinicRole } = useAuth();
  if (status !== 'authenticated') {
    return null;
  }
  if (clinicRole?.clinic_id) {
    return clinicRole.clinic_id;
  }
  return null;
}

export function useIsPlatformAdmin(): boolean {
  const { status, me } = useAuth();
  return status === 'authenticated' && me?.user.platform_role === 'platform_admin';
}
