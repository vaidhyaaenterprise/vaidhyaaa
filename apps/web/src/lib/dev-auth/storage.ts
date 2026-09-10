import {
  DEV_AUTH_STORAGE_KEY,
  type DevAuthProfile,
  type DevAuthRole,
} from './constants';

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
    raw = window.localStorage.getItem(DEV_AUTH_STORAGE_KEY);
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
        window.localStorage.removeItem(DEV_AUTH_STORAGE_KEY);
      } catch {
        // noop
      }
      return null;
    }
    return parsed;
  } catch {
    try {
      window.localStorage.removeItem(DEV_AUTH_STORAGE_KEY);
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
    window.localStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // noop
  }
}

export function clearDevAuthProfile(): void {
  if (!hasWindow()) {
    return;
  }

  try {
    window.localStorage.removeItem(DEV_AUTH_STORAGE_KEY);
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
