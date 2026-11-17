'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { ClinicSwitcher } from '@/components/layout/ClinicSwitcher';
import { fetchDoctors, type DoctorApiRow } from '@/lib/api/clinic-clinical';
import { clearDevAuthProfile } from '@/lib/dev-auth/storage';

type DoctorSection = 'today' | 'analytics' | 'history' | 'settings';
const DOCTOR_SECTIONS: Array<{ id: DoctorSection; label: string; icon: string }> = [
  { id: 'today', label: 'Today', icon: '▦' },
  { id: 'analytics', label: 'Analytics', icon: '▥' },
  { id: 'history', label: 'Patient History', icon: '⌕' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

type DoctorNavContextValue = {
  activeSection: DoctorSection;
  setActiveSection: (section: DoctorSection) => void;
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
  const { clinicRole, me, refresh } = useAuth();
  const [activeSection, setActiveSection] = useState<DoctorSection>('today');
  const [patientCount, setPatientCount] = useState(0);
  const clinicId = clinicRole?.clinic_id ?? null;
  const doctorId = clinicRole?.active && clinicRole.role === 'doctor' ? clinicRole.doctor_id : null;
  const [doctorProfile, setDoctorProfile] = useState<{
    clinicId: string;
    doctorId: string;
    doctor: DoctorApiRow | null;
  } | null>(null);

  useEffect(() => {
    if (!clinicId || !doctorId) {
      setDoctorProfile(null);
      return;
    }
    const controller = new AbortController();
    void fetchDoctors(clinicId, controller.signal)
      .then((doctors) => {
        if (!controller.signal.aborted) {
          setDoctorProfile({
            clinicId,
            doctorId,
            doctor: doctors.find((doctor) => doctor.id === doctorId) ?? null,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setDoctorProfile({ clinicId, doctorId, doctor: null });
      });
    return () => controller.abort();
  }, [clinicId, doctorId]);

  const currentProfile =
    doctorProfile?.clinicId === clinicId && doctorProfile?.doctorId === doctorId
      ? doctorProfile
      : null;
  const doctorName = currentProfile?.doctor?.name ?? me?.user.name ?? 'Doctor';
  const qualification = currentProfile?.doctor?.qualification?.trim();

  async function handleLogout() {
    clearDevAuthProfile();
    await refresh();
    router.push('/login');
  }

  return (
    <DoctorNavContext.Provider
      value={{ activeSection, setActiveSection, patientCount, setPatientCount }}
    >
      <div className="grid min-h-screen w-full max-w-full lg:grid-cols-[272px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:overflow-y-auto lg:bg-[#0b1220] lg:px-[22px] lg:py-[22px] lg:text-slate-200">
          {/* Brand */}
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-[46px] w-[46px] items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-blue-600 text-[22px] font-black text-white">
              V
            </div>
            <div>
              <p className="text-xl font-extrabold text-white">Vaidhyaa</p>
              <p className="text-xs text-slate-400">Doctor Portal</p>
            </div>
          </div>

          {/* Doctor Card */}
          <div className="mb-[18px] rounded-[18px] border border-white/[0.09] bg-white/[0.06] p-[14px]">
            <div className="mb-2 flex items-center gap-[10px]">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-700 to-blue-600 text-[15px] font-extrabold text-white">
                {doctorName
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)}
              </div>
              <div>
                <p className="text-sm font-bold text-white">{doctorName}</p>
                <p className="text-xs text-slate-400">
                  {qualification ||
                    (currentProfile
                      ? currentProfile.doctor
                        ? 'Qualification not added'
                        : 'Doctor details unavailable'
                      : 'Loading doctor details…')}
                </p>
              </div>
            </div>
          </div>

          <div className="mb-[18px]">
            <ClinicSwitcher readOnly />
          </div>

          {/* Nav */}
          <nav className="flex flex-col gap-1.5" aria-label="Doctor navigation">
            {DOCTOR_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                aria-current={activeSection === section.id ? 'page' : undefined}
                onClick={() => setActiveSection(section.id)}
                className={`flex w-full items-center justify-between rounded-[14px] px-[13px] py-[11px] text-left text-sm font-bold transition-colors ${activeSection === section.id ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
              >
                <span className="flex items-center gap-[9px]">
                  <span aria-hidden="true">{section.icon}</span> {section.label}
                </span>
                {section.id === 'today' ? (
                  <span className="rounded-full bg-teal-700 px-2 py-0.5 text-xs font-extrabold text-white">
                    {patientCount}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="mt-auto pt-6">
            <div className="mb-2 h-px bg-white/[0.08]" />
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-[9px] rounded-[14px] px-[13px] py-[11px] text-left text-sm font-bold text-red-400 hover:bg-white/10"
            >
              <span>⇥</span> Logout
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="portal-main min-w-0 overflow-y-auto px-4 py-5 pb-14 sm:px-6 sm:py-7 sm:pb-16 lg:px-8">
          <div className="mb-5 lg:hidden">
            <div className="mb-3 rounded-2xl bg-[#0b1220] p-4">
              <p className="font-bold text-white">{doctorName}</p>
              {qualification ? (
                <p className="mb-3 text-xs text-slate-400">{qualification}</p>
              ) : null}
              <ClinicSwitcher readOnly />
            </div>
            <nav className="flex flex-wrap gap-2" aria-label="Doctor mobile navigation">
              {DOCTOR_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  aria-current={activeSection === section.id ? 'page' : undefined}
                  onClick={() => setActiveSection(section.id)}
                  className={`rounded-xl px-3 py-2 text-sm font-bold ${activeSection === section.id ? 'bg-teal-700 text-white' : 'border bg-white text-slate-700'}`}
                >
                  {section.label}
                </button>
              ))}
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-xl px-3 py-2 text-sm font-bold text-red-600"
              >
                Logout
              </button>
            </nav>
          </div>
          {children}
        </main>
      </div>
    </DoctorNavContext.Provider>
  );
}
