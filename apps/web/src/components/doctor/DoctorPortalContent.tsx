'use client';

import { useDoctorNav } from './DoctorLayout';
import type { DoctorSection } from '@/lib/doctor-navigation';
import { TodayQueue } from './TodayQueue';
import { DoctorAnalytics } from './DoctorAnalytics';
import { DoctorPatientHistory } from './DoctorPatientHistory';
import { DoctorSettings } from './DoctorSettings';

export function DoctorPortalContent({ section }: { section?: DoctorSection }) {
  const { activeSection: routeSection } = useDoctorNav();
  const activeSection = section ?? routeSection;

  if (activeSection === 'analytics') {
    return <DoctorAnalytics />;
  }

  if (activeSection === 'history') {
    return <DoctorPatientHistory />;
  }

  if (activeSection === 'settings') {
    return <DoctorSettings />;
  }

  return <TodayQueue />;
}
