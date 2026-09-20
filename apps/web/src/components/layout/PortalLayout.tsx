'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { RequireAuth } from '@/components/auth/RequireAuth';
import { AppShell } from '@/components/layout/AppShell';

export function PortalLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <RequireAuth pathname={pathname}>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
