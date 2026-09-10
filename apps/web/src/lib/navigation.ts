import type { ClinicRole } from '@vaidya/shared';

export type PortalTabId =
  | 'home'
  | 'call-inbox'
  | 'appointments'
  | 'patient-history'
  | 'clinic-setup'
  | 'knowledge-base'
  | 'settings';

export type PortalNavItem = {
  id: PortalTabId;
  label: string;
  href: string;
  adminOnly?: boolean;
};

export const PORTAL_NAV_ITEMS: PortalNavItem[] = [
  { id: 'home', label: 'Home', href: '/' },
  { id: 'call-inbox', label: 'Call inbox', href: '/call-inbox', adminOnly: true },
  { id: 'appointments', label: 'Appointments', href: '/appointments' },
  { id: 'patient-history', label: 'Patient History', href: '/patient-history', adminOnly: true },
  { id: 'clinic-setup', label: 'Clinic setup', href: '/clinic-setup' },
  { id: 'settings', label: 'Settings', href: '/settings' },
  { id: 'knowledge-base', label: 'Knowledge base', href: '/knowledge-base', adminOnly: true },
];

export type EffectiveRole = 'admin' | 'doctor';

export function resolveEffectiveRole(input: {
  platformRole: string | null;
  clinicRole?: ClinicRole | null;
}): EffectiveRole {
  if (input.platformRole === 'platform_admin' || input.platformRole === 'support') {
    return 'admin';
  }
  if (input.clinicRole === 'clinic_admin') {
    return 'admin';
  }
  return 'doctor';
}

export function canAccessRoute(
  pathname: string,
  effectiveRole: EffectiveRole,
): boolean {
  const item = PORTAL_NAV_ITEMS.find((nav) => nav.href === pathname);
  if (!item) {
    return true;
  }
  if (item.adminOnly && effectiveRole === 'doctor') {
    return false;
  }
  return true;
}

export function visibleNavItems(effectiveRole: EffectiveRole): PortalNavItem[] {
  return PORTAL_NAV_ITEMS.filter((item) => {
    if (item.adminOnly && effectiveRole === 'doctor') {
      return false;
    }
    return true;
  });
}

export function canToggleAgent(effectiveRole: EffectiveRole): boolean {
  return effectiveRole === 'admin';
}
