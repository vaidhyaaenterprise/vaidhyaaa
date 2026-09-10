'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { clearDevAuthProfile } from '@/lib/dev-auth/storage';

type DoctorNavContextValue = {
  activeSection: 'today' | 'analytics' | 'history';
  setActiveSection: (section: 'today' | 'analytics' | 'history') => void;
  patientCount: number;
  setPatientCount: (count: number) => void;
};

const DoctorNavContext = createContext<DoctorNavContextValue | null>(null);

export function useDoctorNav() {
  const ctx = useContext(DoctorNavContext);
  if (!ctx) throw new Error('useDoctorNav must be used within DoctorLayout');
  return ctx;
}

export function DoctorLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { me, refresh } = useAuth();
  const [activeSection, setActiveSection] = useState<'today' | 'analytics' | 'history'>('today');
  const [patientCount, setPatientCount] = useState(8);

  const doctorName = me?.user.name ?? 'Dr. Priya';

  async function handleLogout() {
    clearDevAuthProfile();
    await refresh();
    router.push('/login');
  }

  return (
    <DoctorNavContext.Provider value={{ activeSection, setActiveSection, patientCount, setPatientCount }}>
      <div className="grid min-h-screen lg:grid-cols-[272px_1fr]">
        {/* Sidebar */}
        <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:bg-[#0b1220] lg:px-[22px] lg:py-[22px] lg:text-slate-200">
          {/* Brand */}
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-[46px] w-[46px] items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-blue-600 text-[22px] font-black text-white">
              V
            </div>
            <div>
              <p className="text-xl font-extrabold text-white">Vaidya</p>
              <p className="text-xs text-slate-400">Doctor Portal</p>
            </div>
          </div>

          {/* Doctor Card */}
          <div className="mb-[18px] rounded-[18px] border border-white/[0.09] bg-white/[0.06] p-[14px]">
            <div className="mb-2 flex items-center gap-[10px]">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-700 to-blue-600 text-[15px] font-extrabold text-white">
                {doctorName.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div>
                <p className="text-sm font-bold text-white">{doctorName}</p>
                <p className="text-xs text-slate-400">Orthopaedic Surgeon</p>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">Sri Murugan Clinic · Anna Nagar</p>
          </div>

          {/* Nav */}
          <nav className="flex flex-col gap-1.5" aria-label="Doctor navigation">
            <button
              type="button"
              onClick={() => setActiveSection('today')}
              className={`flex w-full items-center justify-between rounded-[14px] px-[13px] py-[11px] text-left text-sm font-bold transition-colors ${
                activeSection === 'today'
                  ? 'bg-white text-slate-900'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-[9px]">
                <span>▦</span> Today
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${
                  activeSection === 'today'
                    ? 'bg-teal-700 text-white'
                    : 'bg-white/[0.15] text-slate-400'
                }`}
              >
                {patientCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('analytics')}
              className={`flex w-full items-center justify-between rounded-[14px] px-[13px] py-[11px] text-left text-sm font-bold transition-colors ${
                activeSection === 'analytics'
                  ? 'bg-white text-slate-900'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-[9px]">
                <span>▥</span> Analytics
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('history')}
              className={`flex w-full items-center justify-between rounded-[14px] px-[13px] py-[11px] text-left text-sm font-bold transition-colors ${
                activeSection === 'history'
                  ? 'bg-white text-slate-900'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-[9px]">
                <span>⌕</span> Patient History
              </span>
            </button>
            <div className="my-2 h-px bg-white/[0.08]" />
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-[9px] rounded-[14px] px-[13px] py-[11px] text-left text-sm font-bold text-red-400 hover:bg-white/10"
            >
              <span>⇥</span> Logout
            </button>
          </nav>

          {/* Duty Status */}
          <div className="mt-auto">
            <div className="rounded-[18px] border border-teal-400/25 bg-teal-500/[0.13] p-[14px]">
              <div className="flex items-center gap-[7px] text-[13px] font-bold text-teal-300">
                <span className="inline-block h-2 w-2 rounded-full bg-teal-300" />
                On Duty
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-teal-100/80">
                Morning shift · 9:00 AM – 1:00 PM<br />
                Next: Evening 5:00 – 9:00 PM
              </p>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 overflow-y-auto px-4 py-5 pb-14 sm:px-6 sm:py-7 sm:pb-16 lg:px-8">
          {children}
        </main>
      </div>
    </DoctorNavContext.Provider>
  );
}
