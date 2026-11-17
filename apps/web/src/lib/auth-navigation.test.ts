import { describe, expect, it } from 'vitest';

import { getPostLoginPath, getSignInPath } from './auth-navigation';
import { doctorSectionFromPathname, doctorSectionHref } from './doctor-navigation';

describe('doctor route destinations', () => {
  it.each([
    ['/doctor', 'today'],
    ['/doctor/analytics', 'analytics'],
    ['/doctor/patient-history', 'history'],
    ['/doctor/settings', 'settings'],
  ] as const)('uses %s as the canonical %s route', (path, section) => {
    expect(doctorSectionFromPathname(path)).toBe(section);
    expect(doctorSectionFromPathname(`${path}/`)).toBe(section);
    expect(doctorSectionHref(section)).toBe(path);
    expect(getPostLoginPath(path, 'doctor')).toBe(path);
    expect(getPostLoginPath(path, 'admin')).toBe('/');
  });

  it('preserves safe internal query and hash state after login', () => {
    expect(getPostLoginPath('/doctor/settings?panel=holidays#upcoming', 'doctor')).toBe(
      '/doctor/settings?panel=holidays#upcoming',
    );
    expect(getPostLoginPath('/appointments?date=2026-11-17', 'admin')).toBe(
      '/appointments?date=2026-11-17',
    );
    expect(getPostLoginPath('/appointments', 'doctor')).toBe('/doctor');
  });

  it.each([
    undefined,
    null,
    '',
    'https://example.com/doctor/settings',
    '//example.com/doctor/settings',
    '/\\example.com/doctor/settings',
    '/doctor\\settings',
    '/doctor/settings\n',
    '/doctor/settings\u0000',
    '/%2f%2fexample.com',
    '/login',
    '/login?next=/doctor/settings',
    '/unknown',
  ])('rejects an unsafe or unsupported return destination: %s', (next) => {
    expect(getPostLoginPath(next, 'doctor')).toBe('/doctor');
    expect(getPostLoginPath(next, 'admin')).toBe('/');
  });

  it('encodes the intended page for a fresh sign-in', () => {
    expect(getSignInPath('/doctor/settings')).toBe('/login?next=%2Fdoctor%2Fsettings');
    expect(getSignInPath('/doctor/patient-history')).toBe(
      '/login?next=%2Fdoctor%2Fpatient-history',
    );
    expect(getSignInPath('/')).toBe('/login?next=%2F');
    expect(getSignInPath('//example.com')).toBe('/login?next=%2F');
  });
});
