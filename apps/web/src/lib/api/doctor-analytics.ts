import { apiGet } from '@/lib/api/client';

export type DoctorAnalyticsPoint = {
  period_start: string;
  label: string;
  total: number;
  new_patients: number;
  follow_ups: number;
};

export type DoctorAnalyticsMonthlyPoint = DoctorAnalyticsPoint & {
  average_per_day: number;
};

export type DoctorAnalyticsData = {
  stats: {
    confirmed_this_month: number;
    new_confirmed_this_month: number;
    follow_up_confirmed_this_month: number;
    average_confirmed_per_day: number;
  };
  trends: {
    daily: DoctorAnalyticsPoint[];
    weekly: DoctorAnalyticsPoint[];
    monthly: DoctorAnalyticsPoint[];
  };
  top_conditions: Array<{ condition: string; count: number }>;
  age_groups: Array<{ label: string; count: number }>;
  monthly_summary: DoctorAnalyticsMonthlyPoint[];
};

export async function fetchDoctorAnalytics(clinicId: string, signal?: AbortSignal) {
  const data = await apiGet<{ analytics: DoctorAnalyticsData }>(
    `/v1/clinics/${clinicId}/appointments/analytics`,
    signal,
  );
  return data.analytics;
}
