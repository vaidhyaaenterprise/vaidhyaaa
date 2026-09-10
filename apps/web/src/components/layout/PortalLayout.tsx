'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { RequireAuth } from '@/components/auth/RequireAuth';
import { AppShell } from '@/components/layout/AppShell';
import { DevAuthSwitcher } from '@/components/auth/DevAuthSwitcher';
import { useAuth } from '@/components/auth/AuthProvider';

export function PortalLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { me } = useAuth();

  const topBarTitle = me?.user.name ?? 'Portal';

  return (
    <RequireAuth pathname={pathname}>
      <AppShell>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Signed in</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{topBarTitle}</p>
          </div>
          <DevAuthSwitcher />
        </div>
        {children}
      </AppShell>
    </RequireAuth>
  );
}
