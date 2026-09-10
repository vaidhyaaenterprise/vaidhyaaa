'use client';

import type { ReactNode } from 'react';

import { ClinicSwitcher } from '@/components/layout/ClinicSwitcher';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { DEV_SEED } from '@/lib/dev-auth/constants';

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
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

        <ClinicSwitcher clinicName={DEV_SEED.CLINIC_NAME} />

        <div className="mt-4 flex-1">
          <SidebarNav />
        </div>

        <div className="mt-4 rounded-[18px] border border-teal-400/25 bg-teal-500/10 p-3.5">
          <p className="text-sm font-bold text-teal-200">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-teal-300" />
            Voice bot active
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-teal-100/80">
            Answering after 4 rings and outside clinic hours. Last call handled 3 minutes ago.
          </p>
        </div>
      </aside>

      <main className="min-w-0 px-4 py-4 pb-10 sm:px-6 sm:py-6 sm:pb-12 lg:px-8">{children}</main>
    </div>
  );
}
