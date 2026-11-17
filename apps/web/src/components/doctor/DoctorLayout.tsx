'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { ClinicSwitcher } from '@/components/layout/ClinicSwitcher';
import {
  fetchDoctors,
  fetchDoctorServices,
  fetchServices,
  type DoctorApiRow,
} from '@/lib/api/clinic-clinical';
import { clearDevAuthProfile } from '@/lib/dev-auth/storage';

import {
  DOCTOR_NAV_ITEMS,
  doctorSectionFromPathname,
  doctorSectionHref,
  type DoctorSection,
} from '@/lib/doctor-navigation';

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
  const pathname = usePathname() ?? '/doctor';
  const activeSection = doctorSectionFromPathname(pathname);
  const setActiveSection = useCallback(
    (section: DoctorSection) => {
      router.push(doctorSectionHref(section));
    },
    [router],
  );
  const [patientCount, setPatientCount] = useState(0);
  const clinicId = clinicRole?.clinic_id ?? null;
  const doctorId = clinicRole?.active && clinicRole.role === 'doctor' ? clinicRole.doctor_id : null;
  const [doctorProfile, setDoctorProfile] = useState<{
    clinicId: string;
    doctorId: string;
    doctor: DoctorApiRow | null;
    serviceNames: string[];
    serviceStatus: 'ready' | 'unavailable';
  } | null>(null);

  useEffect(() => {
    if (!clinicId || !doctorId) {
      setDoctorProfile(null);
      return;
    }
    const controller = new AbortController();
    void Promise.allSettled([
      fetchDoctors(clinicId, controller.signal),
      fetchDoctorServices(clinicId, controller.signal),
      fetchServices(clinicId, controller.signal),
    ])
      .then(([doctorsResult, mappingsResult, servicesResult]) => {
        if (!controller.signal.aborted) {
          const doctors = doctorsResult.status === 'fulfilled' ? doctorsResult.value : [];
          const serviceStatus =
            mappingsResult.status === 'fulfilled' && servicesResult.status === 'fulfilled'
              ? 'ready'
              : 'unavailable';
          const activeServices = new Map(
            servicesResult.status === 'fulfilled'
              ? servicesResult.value
                  .filter((service) => service.active)
                  .map((service) => [service.id, service.service_name] as const)
              : [],
          );
          const serviceNames =
            mappingsResult.status === 'fulfilled'
              ? [
                  ...new Set(
                    mappingsResult.value
                      .filter((mapping) => mapping.active && mapping.doctor_id === doctorId)
                      .map((mapping) => activeServices.get(mapping.clinic_service_id))
                      .filter((name): name is string => Boolean(name?.trim()))
                      .map((name) => name.trim()),
                  ),
                ].sort((left, right) => left.localeCompare(right))
              : [];
          setDoctorProfile({
            clinicId,
            doctorId,
            doctor: doctors.find((doctor) => doctor.id === doctorId) ?? null,
            serviceNames,
            serviceStatus,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setDoctorProfile({
            clinicId,
            doctorId,
            doctor: null,
            serviceNames: [],
            serviceStatus: 'unavailable',
          });
      });
    return () => controller.abort();
  }, [clinicId, doctorId]);

  const currentProfile =
    doctorProfile?.clinicId === clinicId && doctorProfile?.doctorId === doctorId
      ? doctorProfile
      : null;
  const doctorName = currentProfile?.doctor?.name ?? me?.user.name ?? 'Doctor';
  const qualification = currentProfile?.doctor?.qualification?.trim();
  const serviceNames = currentProfile?.serviceNames ?? [];
  const serviceText = serviceNames.join(', ');
  const serviceDisplay = currentProfile
    ? currentProfile.serviceStatus === 'unavailable'
      ? 'Service details unavailable'
      : serviceText || 'Not assigned'
    : 'Loading…';
  const serviceLabel = serviceNames.length > 1 ? 'Services' : 'Service';

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
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">{doctorName}</p>
                <p className="text-xs text-slate-400">
                  {qualification ||
                    (currentProfile
                      ? currentProfile.doctor
                        ? 'Qualification not added'
                        : 'Doctor details unavailable'
                      : 'Loading doctor details…')}
                </p>
                <p
                  className={`mt-1 break-words text-[11px] font-semibold leading-4 ${serviceNames.length ? 'text-teal-300' : 'text-slate-500'}`}
                  title={serviceText || undefined}
                >
                  {serviceLabel}: {serviceDisplay}
                </p>
              </div>
            </div>
          </div>

          <div className="mb-[18px]">
            <ClinicSwitcher readOnly />
          </div>

          {/* Nav */}
          <nav className="flex flex-col gap-1.5" aria-label="Doctor navigation">
            {DOCTOR_NAV_ITEMS.map((section) => (
              <Link
                key={section.id}
                href={section.href}
                aria-current={activeSection === section.id ? 'page' : undefined}
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
              </Link>
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
              {qualification ? <p className="text-xs text-slate-400">{qualification}</p> : null}
              <p
                className={`mb-3 mt-1 break-words text-xs font-semibold ${serviceNames.length ? 'text-teal-300' : 'text-slate-500'}`}
                title={serviceText || undefined}
              >
                {serviceLabel}: {serviceDisplay}
              </p>
              <ClinicSwitcher readOnly />
            </div>
            <nav className="flex flex-wrap gap-2" aria-label="Doctor mobile navigation">
              {DOCTOR_NAV_ITEMS.map((section) => (
                <Link
                  key={section.id}
                  href={section.href}
                  aria-current={activeSection === section.id ? 'page' : undefined}
                  className={`rounded-xl px-3 py-2 text-sm font-bold ${activeSection === section.id ? 'bg-teal-700 text-white' : 'border bg-white text-slate-700'}`}
                >
                  {section.label}
                </Link>
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
