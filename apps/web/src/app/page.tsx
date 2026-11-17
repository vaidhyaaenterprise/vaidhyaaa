'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LoadingState } from '@/components/ui/StateViews';
import { PortalLayout } from '@/components/layout/PortalLayout';
import { HomePageContent } from '@/components/pages/HomePageContent';

export default function HomePage() {
  const router = useRouter();
  const { effectiveRole, status } = useAuth();

  useEffect(() => {
    if (status === 'authenticated' && effectiveRole === 'doctor') router.replace('/doctor');
  }, [effectiveRole, router, status]);

  if (status !== 'authenticated') {
    return (
      <RequireAuth pathname="/">
        <div />
      </RequireAuth>
    );
  }

  if (effectiveRole === 'doctor') {
    return (
      <LoadingState title="Opening Doctor Portal" description="Loading your appointment queue." />
    );
  }

  return (
    <PortalLayout>
      <HomePageContent />
    </PortalLayout>
  );
}
