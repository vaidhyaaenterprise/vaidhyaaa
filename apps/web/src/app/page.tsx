'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { DoctorLayout } from '@/components/doctor/DoctorLayout';
import { DoctorPortalContent } from '@/components/doctor/DoctorPortalContent';
import { PortalLayout } from '@/components/layout/PortalLayout';
import { HomePageContent } from '@/components/pages/HomePageContent';

export default function HomePage() {
  const { effectiveRole, status } = useAuth();

  if (status !== 'authenticated') {
    return (
      <RequireAuth pathname="/">
        <div />
      </RequireAuth>
    );
  }

  if (effectiveRole === 'doctor') {
    return (
      <DoctorLayout>
        <DoctorPortalContent />
      </DoctorLayout>
    );
  }

  return (
    <PortalLayout>
      <HomePageContent />
    </PortalLayout>
  );
}
