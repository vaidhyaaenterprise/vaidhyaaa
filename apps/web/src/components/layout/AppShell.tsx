'use client';

import type { ReactNode } from 'react';

import { DevAuthSwitcher } from '@/components/auth/DevAuthSwitcher';
import { useAuth } from '@/components/auth/AuthProvider';
import { ClinicSwitcher } from '@/components/layout/ClinicSwitcher';
import { SidebarNav } from '@/components/layout/SidebarNav';

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { me } = useAuth();
  const signedInName = me?.user.name ?? 'Signed-in user';

  return (
    <div className="grid min-h-screen lg:grid-cols-[280px_1fr]">
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:bg-sidebar lg:px-[22px] lg:py-[22px] lg:text-slate-200">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-blue-600 text-xl font-black text-white">
            V
          </div>
          <div>
            <p className="text-[21px] font-bold text-white">Vaidya</p>
            <p className="text-[13px] text-slate-400">AI voice receptionist</p>
          </div>
        </div>

        <ClinicSwitcher />

        <div className="mt-4 flex-1">
          <SidebarNav />
        </div>

        <SignedInCard name={signedInName} />
      </aside>

      <main className="min-w-0 px-4 py-4 pb-10 sm:px-6 sm:py-6 sm:pb-12 lg:px-8">
        {children}
        <div className="mt-6 lg:hidden">
          <SignedInCard name={signedInName} />
        </div>
      </main>
    </div>
  );
}

function SignedInCard({ name }: { name: string }) {
  return (
    <section
      aria-label="Signed-in account"
      className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.06] p-3.5 max-lg:border-slate-200 max-lg:bg-white max-lg:shadow-sm"
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Signed in</p>
      <p className="mt-1 truncate text-sm font-bold text-white max-lg:text-slate-900">{name}</p>
      <DevAuthSwitcher />
    </section>
  );
}
