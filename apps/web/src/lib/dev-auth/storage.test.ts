import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTH_TOKEN_STORAGE_KEY,
  DEV_AUTH_PRESETS,
  DEV_AUTH_STORAGE_KEY,
  SHARED_AUTH_SESSION_STORAGE_KEY,
} from './constants';
import {
  clearDevAuthProfile,
  getAuthSessionVersion,
  persistVerifiedAuthSession,
  readAccessToken,
  readDevAuthProfile,
  writeAuthSession,
  writeAccessToken,
  writeDevAuthProfile,
} from './storage';

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
describe('shared browser login storage', () => {
  it('never adopts a standalone legacy profile as a valid shared session', () => {
    window.localStorage.setItem(
      DEV_AUTH_STORAGE_KEY,
      JSON.stringify(DEV_AUTH_PRESETS.clinic_admin.profile),
    );
    expect(readDevAuthProfile()).toBeNull();
    writeAuthSession('doctor-token', DEV_AUTH_PRESETS.doctor.profile);
    expect(readDevAuthProfile()).toEqual(DEV_AUTH_PRESETS.doctor.profile);
    expect(readAccessToken()).toBe('doctor-token');
    expect(window.sessionStorage.getItem(DEV_AUTH_STORAGE_KEY)).toBeTruthy();
    expect(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(SHARED_AUTH_SESSION_STORAGE_KEY)).toBeTruthy();
    clearDevAuthProfile();
    expect(readDevAuthProfile()).toBeNull();
    expect(readAccessToken()).toBeNull();
    expect(window.localStorage.getItem(DEV_AUTH_STORAGE_KEY)).toBeNull();
  });
  it('bootstraps an empty manually opened tab from one atomic shared session', () => {
    writeAuthSession('admin-token', DEV_AUTH_PRESETS.clinic_admin.profile);
    window.sessionStorage.clear();

    expect(readDevAuthProfile()).toEqual(DEV_AUTH_PRESETS.clinic_admin.profile);
    expect(readAccessToken()).toBe('admin-token');
    expect(window.sessionStorage.getItem(DEV_AUTH_STORAGE_KEY)).toBeTruthy();
    expect(window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('admin-token');
  });
  it('fails closed when the shared session envelope is malformed', () => {
    writeAccessToken('doctor-token');
    writeDevAuthProfile(DEV_AUTH_PRESETS.doctor.profile);
    window.localStorage.setItem(SHARED_AUTH_SESSION_STORAGE_KEY, '{"version":1,"token":');

    expect(readDevAuthProfile()).toBeNull();
    expect(readAccessToken()).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(SHARED_AUTH_SESSION_STORAGE_KEY)!)).toEqual({
      version: 1,
      signed_out: true,
    });
  });
  it('keeps copied credentials signed out even when that tab missed the logout event', () => {
    writeAuthSession('doctor-token', DEV_AUTH_PRESETS.doctor.profile);
    const copiedToken = window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY)!;
    const copiedProfile = window.sessionStorage.getItem(DEV_AUTH_STORAGE_KEY)!;
    clearDevAuthProfile();
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, copiedToken);
    window.sessionStorage.setItem(DEV_AUTH_STORAGE_KEY, copiedProfile);
    expect(readAccessToken()).toBeNull();
    expect(readDevAuthProfile()).toBeNull();
    expect(persistVerifiedAuthSession(copiedToken, DEV_AUTH_PRESETS.doctor.profile)).toBe(false);
  });
  it('allows an explicit fresh login after logout, but rejects a late old verification', () => {
    writeAuthSession('old-doctor-token', DEV_AUTH_PRESETS.doctor.profile);
    clearDevAuthProfile();
    writeAuthSession('new-admin-token', DEV_AUTH_PRESETS.clinic_admin.profile);
    expect(persistVerifiedAuthSession('old-doctor-token', DEV_AUTH_PRESETS.doctor.profile)).toBe(
      false,
    );
    expect(readAccessToken()).toBe('new-admin-token');
    expect(readDevAuthProfile()).toEqual(DEV_AUTH_PRESETS.clinic_admin.profile);
  });
  it('changes the session version even when a user signs back in with an identical token', () => {
    writeAuthSession('same-token', DEV_AUTH_PRESETS.doctor.profile);
    const original = getAuthSessionVersion();
    clearDevAuthProfile();
    writeAuthSession('same-token', DEV_AUTH_PRESETS.doctor.profile);
    expect(getAuthSessionVersion()).toBeGreaterThan(original);
  });
});
