export type DoctorSection = 'today' | 'analytics' | 'history' | 'settings';

export const DOCTOR_NAV_ITEMS: Array<{
  id: DoctorSection;
  label: string;
  icon: string;
  href: string;
}> = [
  { id: 'today', label: 'Today', icon: '▦', href: '/doctor' },
  { id: 'analytics', label: 'Analytics', icon: '▥', href: '/doctor/analytics' },
  { id: 'history', label: 'Patient History', icon: '⌕', href: '/doctor/patient-history' },
  { id: 'settings', label: 'Settings', icon: '⚙', href: '/doctor/settings' },
];

export function doctorSectionFromPathname(pathname: string): DoctorSection {
  const path = pathname.replace(/\/+$/, '') || '/';
  return DOCTOR_NAV_ITEMS.find((section) => section.href === path)?.id ?? 'today';
}

export function doctorSectionHref(section: DoctorSection): string {
  return DOCTOR_NAV_ITEMS.find((item) => item.id === section)?.href ?? '/doctor';
}
