import { apiGet, apiPost } from '@/lib/api/client';

export type PlatformClinicRow = {
  id: string;
  name: string;
  active: boolean;
  onboarding_status: string;
};

export type PlatformOnboardingResponse = {
  clinic: Record<string, unknown>;
  settings: {
    agent_enabled: boolean;
    answering_mode: string;
    booking_mode: string;
  } | null;
  checklist: Record<string, boolean> | null;
  languages: unknown[];
  subscription: unknown;
};

export async function fetchPlatformClinics() {
  const data = await apiGet<{ clinics: PlatformClinicRow[] }>('/internal/platform/clinics');
  return data.clinics;
}

export async function fetchPlatformOnboarding(clinicId: string) {
  return apiGet<PlatformOnboardingResponse>(`/internal/platform/clinics/${clinicId}/onboarding`);
}

export async function suspendPlatformClinic(clinicId: string) {
  return apiPost<{ clinic: PlatformClinicRow }>(`/internal/platform/clinics/${clinicId}/suspend`);
}

export async function activatePlatformClinic(clinicId: string) {
  return apiPost<{ clinic: PlatformClinicRow }>(`/internal/platform/clinics/${clinicId}/activate`);
}
