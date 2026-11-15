import {
  AUTH_TOKEN_STORAGE_KEY,
  DEV_AUTH_STORAGE_KEY,
  type DevAuthProfile,
  type DevAuthRole,
} from './constants';

export { initializeTabSession } from './tab-session';
export const AUTH_SESSION_CHANGED_EVENT = 'vaidhyaa:auth-session-changed';
let sessionVersion = 0;
export function getAuthSessionVersion(): number {
  return sessionVersion;
}

const DEV_AUTH_ROLES: readonly DevAuthRole[] = ['platform_admin', 'clinic_admin', 'doctor'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export function readDevAuthProfile(): DevAuthProfile | null {
  if (!hasWindow()) {
    return null;
  }

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
      try {
        window.sessionStorage.removeItem(DEV_AUTH_STORAGE_KEY);
      } catch {
        // noop
      }
      return null;
    }
    return parsed;
  } catch {
    try {
      window.sessionStorage.removeItem(DEV_AUTH_STORAGE_KEY);
    } catch {
      // noop
    }
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
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
}

export function readAccessToken(): string | null {
  if (!hasWindow()) {
    return null;
  }

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
