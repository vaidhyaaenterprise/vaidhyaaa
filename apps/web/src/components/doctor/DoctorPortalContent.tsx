'use client';

import { useDoctorNav } from './DoctorLayout';
import { TodayQueue } from './TodayQueue';
import { DoctorAnalytics } from './DoctorAnalytics';
import { DoctorPatientHistory } from './DoctorPatientHistory';
import { DoctorSettings } from './DoctorSettings';

export function DoctorPortalContent() {
  const { activeSection } = useDoctorNav();

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
