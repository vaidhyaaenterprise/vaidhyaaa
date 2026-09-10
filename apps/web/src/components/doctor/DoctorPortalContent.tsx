'use client';

import { useDoctorNav } from './DoctorLayout';
import { TodayQueue } from './TodayQueue';
import { DoctorAnalytics } from './DoctorAnalytics';
import { DoctorPatientHistory } from './DoctorPatientHistory';

export function DoctorPortalContent() {
  const { activeSection } = useDoctorNav();

  if (activeSection === 'analytics') {
    return <DoctorAnalytics />;
  }

  if (activeSection === 'history') {
    return <DoctorPatientHistory />;
  }

  return <TodayQueue />;
}
