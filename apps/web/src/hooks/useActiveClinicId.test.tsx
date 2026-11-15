import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useActiveClinicId, useIsPlatformAdmin } from '@/hooks/useActiveClinicId';
import { DEV_AUTH_STORAGE_KEY } from '@/lib/dev-auth/constants';

const authMock = vi.hoisted(() => ({
  status: 'authenticated',
  platformRole: null as string | null,
  clinicRole: null as { clinic_id: string } | null,
  clinics: [] as Array<{ clinic_id: string }>,
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: authMock.status,
    clinicRole: authMock.clinicRole,
    me:
      authMock.clinics.length > 0 || authMock.platformRole
        ? { clinics: authMock.clinics, user: { platform_role: authMock.platformRole } }
        : null,
  }),
}));

beforeEach(() => {
  authMock.status = 'authenticated';
  authMock.platformRole = null;
  authMock.clinicRole = null;
  authMock.clinics = [];
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('useActiveClinicId', () => {
  it('exposes platform privileges only while the server session is authenticated', () => {
    authMock.platformRole = 'platform_admin';
    const { result, rerender } = renderHook(() => useIsPlatformAdmin());
    expect(result.current).toBe(true);
    authMock.status = 'inactive';
    rerender();
    expect(result.current).toBe(false);
  });
  it('does not expose a retained clinic while authentication is inactive or being refreshed', () => {
    authMock.clinicRole = { clinic_id: 'private-clinic' };
    authMock.status = 'inactive';
    const { result, rerender } = renderHook(() => useActiveClinicId());
    expect(result.current).toBeNull();
    authMock.status = 'loading';
    rerender();
    expect(result.current).toBeNull();
  });
  it('prefers the authenticated clinic over an stale tab-stored seed profile', () => {
    window.sessionStorage.setItem(
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
    authMock.clinics = [{ clinic_id: 'unselected-clinic' }];
    const { result } = renderHook(() => useActiveClinicId());

    expect(result.current).toBeNull();
  });
});
