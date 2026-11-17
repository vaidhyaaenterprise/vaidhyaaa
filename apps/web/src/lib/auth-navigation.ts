import { DOCTOR_NAV_ITEMS } from './doctor-navigation';
import { PORTAL_NAV_ITEMS, type EffectiveRole } from './navigation';

const DOCTOR_PATHS = new Set(DOCTOR_NAV_ITEMS.map((item) => item.href));
const ADMIN_PATHS = new Set([
  ...PORTAL_NAV_ITEMS.map((item) => item.href),
  '/internal/platform/clinics',
  '/internal/platform/jobs',
  '/internal/platform/notifications',
]);
const RETURN_ORIGIN = 'https://vaidhyaa.internal';

function knownInternalDestination(value: string | null | undefined): URL | null {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) {
    return null;
  }
  try {
    const url = new URL(value, RETURN_ORIGIN);
    if (url.origin !== RETURN_ORIGIN) return null;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (!DOCTOR_PATHS.has(path) && !ADMIN_PATHS.has(path)) return null;
    url.pathname = path;
    return url;
  } catch {
    return null;
  }
}

export function getPostLoginPath(next: string | null | undefined, role: EffectiveRole): string {
  const fallback = role === 'doctor' ? '/doctor' : '/';
  const target = knownInternalDestination(next);
  if (!target || !(role === 'doctor' ? DOCTOR_PATHS : ADMIN_PATHS).has(target.pathname)) {
    return fallback;
  }
  return `${target.pathname}${target.search}${target.hash}`;
}

export function getSignInPath(pathname: string): string {
  const target = knownInternalDestination(pathname);
  const next = target ? `${target.pathname}${target.search}${target.hash}` : '/';
  return `/login?${new URLSearchParams({ next }).toString()}`;
}
