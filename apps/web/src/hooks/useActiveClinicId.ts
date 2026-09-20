'use client';

import { useAuth } from '@/components/auth/AuthProvider';

export function useActiveClinicId(): string | null {
  const { clinicRole, me } = useAuth();
  if (clinicRole?.clinic_id) {
    return clinicRole.clinic_id;
  }
  if (me?.clinics[0]?.clinic_id) {
    return me.clinics[0].clinic_id;
  }
  return null;
}

export function useIsPlatformAdmin(): boolean {
  const { me } = useAuth();
  return me?.user.platform_role === 'platform_admin';
}
