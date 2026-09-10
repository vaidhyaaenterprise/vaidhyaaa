import { describe, expect, it } from 'vitest';

import {
  canAccessRoute,
  canToggleAgent,
  resolveEffectiveRole,
  visibleNavItems,
} from '@/lib/navigation';

describe('portal navigation RBAC', () => {
  it('admin sees all P00 tabs', () => {
    const items = visibleNavItems('admin');
    expect(items.map((item) => item.label)).toEqual(expect.arrayContaining([
      'Home',
      'Call inbox',
      'Appointments',
      'Patient History',
      'Clinic setup',
      'Knowledge base',
    ]));
  });

  it('doctor hides Call inbox and Knowledge base', () => {
    const items = visibleNavItems('doctor');
    const labels = items.map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(['Home', 'Appointments', 'Clinic setup']));
    expect(labels).not.toContain('Call inbox');
    expect(labels).not.toContain('Knowledge base');
  });

  it('doctor cannot access admin-only routes by URL', () => {
    expect(canAccessRoute('/call-inbox', 'doctor')).toBe(false);
    expect(canAccessRoute('/knowledge-base', 'doctor')).toBe(false);
    expect(canAccessRoute('/patient-history', 'doctor')).toBe(false);
    expect(canAccessRoute('/appointments', 'doctor')).toBe(true);
  });

  it('admin can access admin-only routes', () => {
    expect(canAccessRoute('/call-inbox', 'admin')).toBe(true);
    expect(canAccessRoute('/knowledge-base', 'admin')).toBe(true);
    expect(canAccessRoute('/patient-history', 'admin')).toBe(true);
  });

  it('doctor cannot toggle agent', () => {
    expect(canToggleAgent('doctor')).toBe(false);
    expect(canToggleAgent('admin')).toBe(true);
  });

  it('resolveEffectiveRole maps clinic and platform roles', () => {
    expect(
      resolveEffectiveRole({ platformRole: 'platform_admin', clinicRole: null }),
    ).toBe('admin');
    expect(resolveEffectiveRole({ platformRole: null, clinicRole: 'clinic_admin' })).toBe('admin');
    expect(resolveEffectiveRole({ platformRole: null, clinicRole: 'doctor' })).toBe('doctor');
  });
});
