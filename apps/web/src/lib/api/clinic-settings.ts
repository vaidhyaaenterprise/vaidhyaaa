import { apiGet, apiPatch } from '@/lib/api/client';

export type ClinicSettingsResponse = {
  clinic_id: string;
  agent_enabled: boolean;
  answering_mode: string;
  fallback_phone: string | null;
  overflow_after_rings: number | null;
  booking_mode: string;
  max_concurrent_calls: number;
  recording_retention_days: number;
  transcript_retention_days: number;
  notify_staff_on_pending_appointment: boolean;
  pending_appointment_notification_channel: string | null;
  allow_doctor_service_edit: boolean;
  allow_patient_auto_cancel: boolean;
};

export async function fetchClinicSettings(clinicId: string) {
  const data = await apiGet<{ settings: ClinicSettingsResponse }>(
    `/v1/clinics/${clinicId}/settings`,
  );
  return data.settings;
}

export type ClinicProfile = {
  name: string;
  clinic_unique_number: number;
  primary_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  timezone: string;
};

export async function fetchClinicProfile(clinicId: string) {
  const data = await apiGet<{ clinic: ClinicProfile }>(`/v1/clinics/${clinicId}/profile`);
  return data.clinic;
}

export async function patchClinicSettings(
  clinicId: string,
  patch: Partial<ClinicSettingsResponse>,
) {
  const data = await apiPatch<{ settings: ClinicSettingsResponse }>(
    `/v1/clinics/${clinicId}/settings`,
    patch,
  );
  return data.settings;
}
