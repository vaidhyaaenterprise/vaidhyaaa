import { apiGet, apiPost, apiPut } from '@/lib/api/client';

function clinicPath(clinicId: string, suffix: string) {
  return `/v1/clinics/${clinicId}${suffix}`;
}

export type ScheduleConflictItem = {
  appointment_id?: string;
  slot_id?: string;
  slot_start?: string;
  slot_end?: string;
  hold_id?: string;
  holiday_date?: string;
  reason: string;
};

export type ConflictPreview = {
  blocked: boolean;
  conflicts: ScheduleConflictItem[];
  next_safe_implement_from?: string;
};

export type ClinicSubscriptionApi = {
  plan_key: string;
  plan_name: string;
  status: string;
  included_voice_minutes: number;
  max_concurrent_calls: number;
  recording_retention_days: number;
  transcript_retention_days: number;
  trial_end?: string | null;
  notes?: string | null;
};

export type ClinicUsageApi = {
  month: string;
  used_voice_minutes: number;
  included_voice_minutes: number;
  voice_call_count: number;
};

export type ClinicLanguagesApi = {
  default_language_code: string;
  languages: Array<{
    language_code: string;
    enabled: boolean;
    is_default: boolean;
  }>;
};

export type SupportedLanguageApi = {
  language_code: string;
  display_name: string;
  enabled_platform_wide: boolean;
};

export async function fetchClinicSubscription(clinicId: string) {
  const data = await apiGet<{ subscription: ClinicSubscriptionApi }>(
    clinicPath(clinicId, '/subscription'),
  );
  return data.subscription;
}

export async function fetchClinicUsage(clinicId: string) {
  const data = await apiGet<{ usage: ClinicUsageApi }>(
    clinicPath(clinicId, '/usage/current-month'),
  );
  return data.usage;
}

export async function fetchClinicLanguages(clinicId: string) {
  const data = await apiGet<{ languages: ClinicLanguagesApi }>(clinicPath(clinicId, '/languages'));
  return data.languages;
}

export async function replaceClinicLanguages(
  clinicId: string,
  payload: {
    default_language_code: string;
    languages: Array<{ language_code: string; enabled: boolean; is_default?: boolean }>;
  },
) {
  const data = await apiPut<{ languages: ClinicLanguagesApi }>(
    clinicPath(clinicId, '/languages'),
    payload,
  );
  return data.languages;
}

export async function fetchSupportedLanguages() {
  const data = await apiGet<{ languages: SupportedLanguageApi[] }>('/v1/languages');
  return data.languages;
}

export async function fetchSubscriptionPlans() {
  const data = await apiGet<{
    plans: Array<{
      plan_key: string;
      name: string;
      included_voice_minutes: number;
      active: boolean;
    }>;
  }>('/internal/platform/subscription-plans');
  return data.plans;
}

export async function changeClinicSubscription(
  clinicId: string,
  payload: {
    plan_key: string;
    status: string;
    trial_end?: string | null;
    notes?: string | null;
  },
) {
  return apiPost<{ subscription: { plan_key: string; plan_name: string; status: string } }>(
    `/internal/platform/clinics/${clinicId}/subscription/change`,
    payload,
  );
}

export async function previewBookingRuleChange(
  clinicId: string,
  ruleId: string,
  patch: Partial<{ capacity_per_slot: number; slot_duration_minutes: number }>,
) {
  const data = await apiPost<{ preview: ConflictPreview }>(
    clinicPath(clinicId, `/booking-rules/${ruleId}/preview`),
    patch,
  );
  return data.preview;
}

export async function previewClinicHours(
  clinicId: string,
  windows: Array<{ day_of_week: number; start_time: string; end_time: string; active: boolean }>,
) {
  const data = await apiPost<{ preview: ConflictPreview }>(clinicPath(clinicId, '/hours/preview'), {
    windows,
  });
  return data.preview;
}

export async function previewHoliday(
  clinicId: string,
  payload: { holiday_date: string; is_full_day?: boolean; doctor_ids?: string[] },
) {
  const data = await apiPost<{ preview: ConflictPreview }>(
    clinicPath(clinicId, '/holidays/preview'),
    payload,
  );
  return data.preview;
}

export async function retryPlatformNotification(notificationId: string) {
  return apiPost<{ notification: unknown }>(
    `/internal/platform/notifications/${notificationId}/retry`,
  );
}

export async function cancelPlatformNotification(notificationId: string) {
  return apiPost<{ notification: unknown }>(
    `/internal/platform/notifications/${notificationId}/cancel`,
  );
}
