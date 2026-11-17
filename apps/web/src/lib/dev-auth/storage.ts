import {
  AUTH_TOKEN_STORAGE_KEY,
  DEV_AUTH_STORAGE_KEY,
  SHARED_AUTH_SESSION_STORAGE_KEY,
  type DevAuthProfile,
  type DevAuthRole,
} from './constants';
import { initializeTabSession as initializeTabIdentity } from './tab-session';

export const AUTH_SESSION_CHANGED_EVENT = 'vaidhyaa:auth-session-changed';
let sessionVersion = 0;
export function getAuthSessionVersion(): number {
  return sessionVersion;
}

const DEV_AUTH_ROLES: readonly DevAuthRole[] = ['platform_admin', 'clinic_admin', 'doctor'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHARED_AUTH_SESSION_VERSION = 1;
const SIGNED_OUT_SHARED_SESSION = JSON.stringify({
  version: SHARED_AUTH_SESSION_VERSION,
  signed_out: true,
});

type SharedAuthSession = {
  version: typeof SHARED_AUTH_SESSION_VERSION;
  token: string;
  profile: DevAuthProfile;
};

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function isDevAuthRole(value: unknown): value is DevAuthRole {
  return typeof value === 'string' && DEV_AUTH_ROLES.includes(value as DevAuthRole);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isDevAuthProfile(value: unknown): value is DevAuthProfile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const profile = value as Partial<DevAuthProfile>;
  if (!isUuid(profile.userId) || !isDevAuthRole(profile.role)) {
    return false;
  }

  if (profile.clinicId !== undefined && !isUuid(profile.clinicId)) {
    return false;
  }

  if (profile.doctorId !== undefined && !isUuid(profile.doctorId)) {
    return false;
  }

  return true;
}

function parseSharedAuthSession(raw: string): SharedAuthSession | null {
  try {
    const value = JSON.parse(raw) as Partial<SharedAuthSession>;
    if (
      value.version !== SHARED_AUTH_SESSION_VERSION ||
      typeof value.token !== 'string' ||
      !value.token.trim() ||
      !isDevAuthProfile(value.profile)
    ) {
      return null;
    }
    return {
      version: SHARED_AUTH_SESSION_VERSION,
      token: value.token.trim(),
      profile: value.profile,
    };
  } catch {
    return null;
  }
}

function clearTabCredentials(): boolean {
  if (!hasWindow()) return false;
  let changed = false;
  try {
    changed =
      window.sessionStorage.getItem(DEV_AUTH_STORAGE_KEY) !== null ||
      window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY) !== null;
    window.sessionStorage.removeItem(DEV_AUTH_STORAGE_KEY);
    window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // Storage readers fail closed.
  }
  return changed;
}

/**
 * Reconciles this tab with the single browser-wide session envelope. The
 * envelope is atomic, so a tab can never combine one account's token with
 * another account's role/profile.
 */
export function syncAuthSessionFromShared(options: { clearWhenMissing?: boolean } = {}): boolean {
  if (!hasWindow()) return false;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SHARED_AUTH_SESSION_STORAGE_KEY);
  } catch {
    return false;
  }

  if (!raw) {
    if (options.clearWhenMissing && clearTabCredentials()) sessionVersion += 1;
    return false;
  }

  const shared = parseSharedAuthSession(raw);
  if (!shared) {
    try {
      // Retain a signed-out marker so a copied tab cannot republish an old
      // session when it missed a storage event or predates shared login.
      if (raw !== SIGNED_OUT_SHARED_SESSION) {
        window.localStorage.setItem(SHARED_AUTH_SESSION_STORAGE_KEY, SIGNED_OUT_SHARED_SESSION);
      }
    } catch {
      // noop
    }
    if (clearTabCredentials()) sessionVersion += 1;
    return false;
  }

  const profileJson = JSON.stringify(shared.profile);
  try {
    const changed =
      window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY) !== shared.token ||
      window.sessionStorage.getItem(DEV_AUTH_STORAGE_KEY) !== profileJson;
    if (changed) {
      window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, shared.token);
      window.sessionStorage.setItem(DEV_AUTH_STORAGE_KEY, profileJson);
      sessionVersion += 1;
    }
  } catch {
    return false;
  }
  return true;
}

export async function initializeTabSession(): Promise<void> {
  await initializeTabIdentity();
  syncAuthSessionFromShared();
}

export function readDevAuthProfile(): DevAuthProfile | null {
  if (!hasWindow()) {
    return null;
  }

  syncAuthSessionFromShared();

  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(DEV_AUTH_STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isDevAuthProfile(parsed)) {
      if (clearTabCredentials()) sessionVersion += 1;
      return null;
    }
    return parsed;
  } catch {
    if (clearTabCredentials()) sessionVersion += 1;
    return null;
  }
}

/** A migration hint only; AuthProvider must validate it against /me first. */
export function readLegacyAuthProfileHint(): DevAuthProfile | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(DEV_AUTH_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return isDevAuthProfile(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeDevAuthProfile(profile: DevAuthProfile): void {
  if (!hasWindow() || !isDevAuthProfile(profile)) {
    return;
  }

  try {
    window.sessionStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify(profile));
    sessionVersion += 1;
    window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
  } catch {
    // noop
  }
}

export function persistVerifiedAuthSession(
  token: string,
  profile: DevAuthProfile,
  replaceExisting = false,
): boolean {
  if (!hasWindow() || !token.trim() || !isDevAuthProfile(profile)) return false;
  const shared: SharedAuthSession = {
    version: SHARED_AUTH_SESSION_VERSION,
    token: token.trim(),
    profile,
  };
  try {
    const currentRaw = window.localStorage.getItem(SHARED_AUTH_SESSION_STORAGE_KEY);
    if (currentRaw && !replaceExisting) {
      const current = parseSharedAuthSession(currentRaw);
      if (
        !current ||
        current.token !== shared.token ||
        JSON.stringify(current.profile) !== JSON.stringify(profile)
      )
        return false;
    }
    window.localStorage.setItem(SHARED_AUTH_SESSION_STORAGE_KEY, JSON.stringify(shared));
  } catch {
    // The current tab can continue using sessionStorage if shared storage is unavailable.
  }
  try {
    const profileJson = JSON.stringify(profile);
    const changed =
      window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY) !== shared.token ||
      window.sessionStorage.getItem(DEV_AUTH_STORAGE_KEY) !== profileJson;
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, shared.token);
    window.sessionStorage.setItem(DEV_AUTH_STORAGE_KEY, profileJson);
    if (changed) sessionVersion += 1;
    return true;
  } catch {
    return false;
  }
}

export function writeAuthSession(token: string, profile: DevAuthProfile): void {
  if (!hasWindow() || !token.trim() || !isDevAuthProfile(profile)) return;

  const normalizedToken = token.trim();
  const profileJson = JSON.stringify(profile);
  try {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, normalizedToken);
    window.sessionStorage.setItem(DEV_AUTH_STORAGE_KEY, profileJson);
    persistVerifiedAuthSession(normalizedToken, profile, true);
    sessionVersion += 1;
    window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
  } catch {
    // noop
  }
}

export function clearDevAuthProfile(): void {
  if (!hasWindow()) {
    return;
  }
  sessionVersion += 1;

  try {
    window.sessionStorage.removeItem(DEV_AUTH_STORAGE_KEY);
  } catch {
    // noop
  }

  try {
    window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // noop
  }
  try {
    window.localStorage.setItem(SHARED_AUTH_SESSION_STORAGE_KEY, SIGNED_OUT_SHARED_SESSION);
    window.localStorage.removeItem(DEV_AUTH_STORAGE_KEY);
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // noop
  }
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
}

export function readAccessToken(): string | null {
  if (!hasWindow()) {
    return null;
  }

  syncAuthSessionFromShared();

  try {
    const token = window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim();
    return token || null;
  } catch {
    return null;
  }
}

export function writeAccessToken(token: string): void {
  if (!hasWindow() || !token.trim()) {
    return;
  }

  try {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token.trim());
    sessionVersion += 1;
  } catch {
    // noop
  }
}

export function devAuthHeadersFromProfile(profile: DevAuthProfile): Record<string, string> {
  const headers: Record<string, string> = {
    'x-dev-user-id': profile.userId,
    'x-dev-user-role': profile.role,
  };

  if (profile.clinicId) {
    headers['x-dev-clinic-id'] = profile.clinicId;
  }
  if (profile.doctorId) {
    headers['x-dev-doctor-id'] = profile.doctorId;
  }

  return headers;
}

export function roleFromProfile(profile: DevAuthProfile): DevAuthRole {
  return profile.role;
}
