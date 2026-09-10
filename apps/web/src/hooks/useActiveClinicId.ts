'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { DEV_SEED } from '@/lib/dev-auth/constants';
import { readDevAuthProfile } from '@/lib/dev-auth/storage';

export function useActiveClinicId(): string | null {
  const { clinicRole, me } = useAuth();
  const profile = readDevAuthProfile();
  if (profile?.clinicId) {
    return profile.clinicId;
  }
  if (clinicRole?.clinic_id) {
    return clinicRole.clinic_id;
  }
  if (me?.clinics[0]?.clinic_id) {
    return me.clinics[0].clinic_id;
  }
  return DEV_SEED.CLINIC_ID;
}

export function useIsPlatformAdmin(): boolean {
  const { me } = useAuth();
  return me?.user.platform_role === 'platform_admin';
}
