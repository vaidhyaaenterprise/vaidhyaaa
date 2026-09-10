'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useIsPlatformAdmin } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import {
  activatePlatformClinic,
  fetchPlatformClinics,
  fetchPlatformOnboarding,
  suspendPlatformClinic,
  type PlatformClinicRow,
} from '@/lib/api/platform';

import type { Clinic, OnboardingChecklist } from './types';

function mapClinic(row: PlatformClinicRow): Clinic {
  return {
    id: row.id,
    name: row.name,
    phone: '',
    address: '',
    city: '',
    state: '',
    country: 'India',
    timezone: 'Asia/Kolkata',
    fallbackPhone: '',
    defaultLanguage: 'ta_tanglish',
    plan: 'pilot',
    status: row.active ? 'active' : 'suspended',
    onboardingStatus:
      row.onboarding_status === 'ready_for_agent' ? 'complete' : 'in_progress',
    agentEnabled: false,
    createdAt: new Date().toISOString(),
    adminName: '',
    adminPhone: '',
    adminEmail: '',
  };
}

export function PlatformClinicsList() {
  const isPlatformAdmin = useIsPlatformAdmin();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinic, setSelectedClinic] = useState<Clinic | null>(null);
  const [checklist, setChecklist] = useState<OnboardingChecklist | null>(null);
  const [isOnboardingDetailOpen, setIsOnboardingDetailOpen] = useState(false);

  const loadClinics = useCallback(async () => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchPlatformClinics();
      setClinics(rows.map(mapClinic));
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.apiError.message : 'Failed to load platform clinics.',
      );
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin]);

  useEffect(() => {
    void loadClinics();
  }, [loadClinics]);

  if (!isPlatformAdmin) {
    return (
      <>
        <PageHeader
          title="Platform clinics"
          description="Internal platform admin onboarding screens."
        />
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Access denied. Platform admin only.</p>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Platform clinics" description="Internal platform admin onboarding screens." />
        <LoadingState title="Loading clinics" description="Fetching clinics from the platform API." />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Platform clinics" description="Internal platform admin onboarding screens." />
        <ErrorState title="Could not load clinics" description={error}>
          <button
            type="button"
            onClick={() => void loadClinics()}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white"
          >
            Retry
          </button>
        </ErrorState>
      </>
    );
  }

  const handleToggleStatus = async (clinicId: string, active: boolean) => {
    if (active) {
      await suspendPlatformClinic(clinicId);
    } else {
      await activatePlatformClinic(clinicId);
    }
    await loadClinics();
  };

  const handleViewOnboarding = async (clinic: Clinic) => {
    setSelectedClinic(clinic);
    const onboarding = await fetchPlatformOnboarding(clinic.id);
    const raw = onboarding.checklist ?? {};
    setChecklist({
      clinicDetails: Boolean(raw.clinic_details_done),
      adminUser: Boolean(raw.admin_user_done),
      clinicHours: Boolean(raw.clinic_hours_done),
      doctors: Boolean(raw.doctors_done),
      services: Boolean(raw.services_done),
      doctorServiceMapping: Boolean(raw.doctor_service_mapping_done),
      schedules: Boolean(raw.doctor_schedules_done),
      bookingRules: Boolean(raw.booking_rules_done),
      knowledgeBase: Boolean(raw.knowledge_base_done),
      telephonySetup: Boolean(raw.telephony_setup_done),
      testConversation: Boolean(raw.test_conversation_done),
      readyForAgent: Boolean(raw.ready_for_agent),
    });
    setIsOnboardingDetailOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Platform clinics"
        description="Internal platform admin onboarding screens."
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Clinic name
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Onboarding
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {clinics.map((clinic) => (
                <tr key={clinic.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-semibold text-slate-900">{clinic.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{clinic.onboardingStatus}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{clinic.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleViewOnboarding(clinic)}
                        className="rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700"
                      >
                        Onboarding
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleStatus(clinic.id, clinic.status === 'active')}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700"
                      >
                        {clinic.status === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {clinics.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No clinics found.</p>
          ) : null}
        </div>
      </div>

      {isOnboardingDetailOpen && selectedClinic && checklist ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-bold">Onboarding: {selectedClinic.name}</h3>
            <ul className="space-y-2 text-sm">
              {Object.entries(checklist).map(([key, done]) => (
                <li key={key} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span>{key}</span>
                  <span>{done ? '✓' : '○'}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setIsOnboardingDetailOpen(false)}
              className="mt-4 rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
