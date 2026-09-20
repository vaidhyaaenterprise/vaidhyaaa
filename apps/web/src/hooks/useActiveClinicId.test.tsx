import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { DEV_AUTH_STORAGE_KEY } from '@/lib/dev-auth/constants';

const authMock = vi.hoisted(() => ({
  clinicRole: null as { clinic_id: string } | null,
  clinics: [] as Array<{ clinic_id: string }>,
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    clinicRole: authMock.clinicRole,
    me: authMock.clinics.length > 0 ? { clinics: authMock.clinics } : null,
  }),
}));

beforeEach(() => {
  authMock.clinicRole = null;
  authMock.clinics = [];
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('useActiveClinicId', () => {
  it('prefers the authenticated clinic over an old browser-stored seed profile', () => {
    window.localStorage.setItem(
      DEV_AUTH_STORAGE_KEY,
      JSON.stringify({
        userId: '00000000-0000-0000-0000-000000000102',
        clinicId: '00000000-0000-0000-0000-000000000001',
        role: 'clinic_admin',
      }),
    );
    authMock.clinicRole = { clinic_id: '00000000-0000-0000-0000-000000000999' };

    const { result } = renderHook(() => useActiveClinicId());

    expect(result.current).toBe('00000000-0000-0000-0000-000000000999');
  });

  it('returns null rather than a seed clinic when the session has no clinic membership', () => {
    const { result } = renderHook(() => useActiveClinicId());

    expect(result.current).toBeNull();
  });
});
