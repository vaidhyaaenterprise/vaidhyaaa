import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_TOKEN_STORAGE_KEY, DEV_AUTH_PRESETS, DEV_AUTH_STORAGE_KEY } from './constants';
import {
  clearDevAuthProfile,
  getAuthSessionVersion,
  readAccessToken,
  readDevAuthProfile,
  writeAccessToken,
  writeDevAuthProfile,
} from './storage';

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
describe('tab-scoped login storage', () => {
  it('never adopts a shared legacy admin profile over this tab doctor login', () => {
    window.localStorage.setItem(
      DEV_AUTH_STORAGE_KEY,
      JSON.stringify(DEV_AUTH_PRESETS.clinic_admin.profile),
    );
    expect(readDevAuthProfile()).toBeNull();
    writeAccessToken('doctor-token');
    writeDevAuthProfile(DEV_AUTH_PRESETS.doctor.profile);
    expect(readDevAuthProfile()).toEqual(DEV_AUTH_PRESETS.doctor.profile);
    expect(readAccessToken()).toBe('doctor-token');
    expect(window.sessionStorage.getItem(DEV_AUTH_STORAGE_KEY)).toBeTruthy();
    expect(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    clearDevAuthProfile();
    expect(readDevAuthProfile()).toBeNull();
    expect(readAccessToken()).toBeNull();
    expect(window.localStorage.getItem(DEV_AUTH_STORAGE_KEY)).toBeTruthy();
  });
  it('changes the session version even when a user signs back in with an identical token', () => {
    writeAccessToken('same-token');
    writeDevAuthProfile(DEV_AUTH_PRESETS.doctor.profile);
    const original = getAuthSessionVersion();
    clearDevAuthProfile();
    writeAccessToken('same-token');
    writeDevAuthProfile(DEV_AUTH_PRESETS.doctor.profile);
    expect(getAuthSessionVersion()).toBeGreaterThan(original);
  });
});
