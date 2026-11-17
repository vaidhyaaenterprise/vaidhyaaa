'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { DoctorLayout } from '@/components/doctor/DoctorLayout';
import { LoadingState } from '@/components/ui/StateViews';

export default function DoctorRouteLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/doctor';
  const router = useRouter();
  const { status, effectiveRole } = useAuth();
  const restricted = status === 'authenticated' && effectiveRole !== 'doctor';

  useEffect(() => {
    if (restricted) router.replace('/');
  }, [restricted, router]);

  if (restricted) {
    return <LoadingState title="Opening your workspace" description="Returning to Clinic Admin." />;
  }

  return (
    <RequireAuth pathname={pathname}>
      <DoctorLayout>{children}</DoctorLayout>
    </RequireAuth>
  );
}
