import { apiGet, apiPatch, apiPost, apiPut, apiDelete } from '@/lib/api/client';

function clinicPath(clinicId: string, suffix: string) {
  return `/v1/clinics/${clinicId}${suffix}`;
}

export type DoctorApiRow = {
  id: string;
  name: string;
  qualification: string | null;
  user_id: string | null;
  active: boolean;
};

export type ServiceApiRow = {
  id: string;
  service_name: string;
  service_key: string;
  active: boolean;
};

export type DoctorServiceApiRow = {
  id: string;
  doctor_id: string;
  clinic_service_id: string;
  consultation_fee_amount: string | null;
  active: boolean;
};

export type BookingRuleApiRow = {
  id: string;
  doctor_id: string;
  clinic_service_id: string;
  slot_duration_minutes: number;
  capacity_per_slot: number;
  booking_horizon_days: number;
  manual_edit_cutoff_before_start_minutes: number;
  manual_edit_max_shift_minutes: number;
  effective_from?: string;
  version?: number;
  active: boolean;
};

export type BookingRulePatchPayload = Partial<{
  slot_duration_minutes: number;
  capacity_per_slot: number;
  booking_horizon_days: number;
  manual_edit_cutoff_before_start_minutes: number;
  manual_edit_max_shift_minutes: number;
  implement_from: string;
}>;

export type ClinicHoursApiRow = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  active: boolean;
};

export type HolidayApiRow = {
  id: string;
  holiday_date: string;
  reason: string | null;
  is_full_day: boolean;
  active: boolean;
  applies_to_clinic: boolean;
  doctor_ids: string[];
};

export type DoctorScheduleApiRow = {
  id: string;
  doctor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  active: boolean;
};

export type CallApiRow = {
  id: string;
  patient_phone: string | null;
  patient_name: string | null;
  started_at: string | null;
  duration_seconds: number | null;
  outcome: string | null;
  summary: string | null;
  recording_url: string | null;
};

export type PatientHistoryItemApiRow = {
  kind: 'visit' | 'appointment';
  id: string;
  at: string;
  doctor_id: string;
  doctor_name: string;
  clinic_service_id: string;
  clinic_service_name: string;
  reason_for_visit: string;
  examination_notes?: string;
  diagnosis?: string;
  advice?: string;
  status?: string;
  appointment_request_id?: string | null;
};

export type PatientHistoryApiRow = {
  id: string;
  name: string;
  phone: string | null;
  gender: string | null;
  age: number | null;
  date_of_birth: string | null;
  history: PatientHistoryItemApiRow[];
};

export async function fetchDoctors(clinicId: string) {
  const data = await apiGet<{ doctors: DoctorApiRow[] }>(clinicPath(clinicId, '/doctors'));
  return data.doctors;
}

export async function createDoctor(
  clinicId: string,
  payload: { name: string; qualification?: string; registration_number?: string },
) {
  const data = await apiPost<{ doctor: DoctorApiRow }>(clinicPath(clinicId, '/doctors'), payload);
  return data.doctor;
}

export async function fetchServices(clinicId: string) {
  const data = await apiGet<{ services: ServiceApiRow[] }>(clinicPath(clinicId, '/services'));
  return data.services;
}

export async function createService(
  clinicId: string,
  payload: { service_name: string; service_key?: string; active?: boolean },
) {
  const data = await apiPost<{ service: ServiceApiRow }>(clinicPath(clinicId, '/services'), payload);
  return data.service;
}

export async function fetchDoctorServices(clinicId: string) {
  const data = await apiGet<{ doctor_services: DoctorServiceApiRow[] }>(
    clinicPath(clinicId, '/doctor-services'),
  );
  return data.doctor_services;
}

export async function createDoctorService(
  clinicId: string,
  payload: {
    doctor_id: string;
    clinic_service_id: string;
    consultation_fee_amount?: number;
    followup_fee_amount?: number;
    followup_valid_days?: number;
    active?: boolean;
  },
) {
  const data = await apiPost<{ doctor_service: DoctorServiceApiRow }>(
    clinicPath(clinicId, '/doctor-services'),
    payload,
  );
  return data.doctor_service;
}

export async function patchDoctorService(
  clinicId: string,
  mappingId: string,
  patch: Partial<{ consultation_fee_amount: number; active: boolean }>,
) {
  const data = await apiPatch<{ doctor_service: DoctorServiceApiRow }>(
    clinicPath(clinicId, `/doctor-services/${mappingId}`),
    patch,
  );
  return data.doctor_service;
}

export async function patchService(
  clinicId: string,
  serviceId: string,
  patch: Partial<{ service_name: string; active: boolean }>,
) {
  const data = await apiPatch<{ service: ServiceApiRow }>(
    clinicPath(clinicId, `/services/${serviceId}`),
    patch,
  );
  return data.service;
}

export async function deleteDoctor(clinicId: string, doctorId: string) {
  await apiDelete(clinicPath(clinicId, `/doctors/${doctorId}`));
}

export async function deleteService(clinicId: string, serviceId: string) {
  await apiDelete(clinicPath(clinicId, `/services/${serviceId}`));
}

export async function deleteDoctorService(clinicId: string, mappingId: string) {
  await apiDelete(clinicPath(clinicId, `/doctor-services/${mappingId}`));
}

export async function fetchBookingRules(clinicId: string) {
  const data = await apiGet<{ booking_rules: BookingRuleApiRow[] }>(
    clinicPath(clinicId, '/booking-rules'),
  );
  return data.booking_rules;
}

export async function patchBookingRule(
  clinicId: string,
  ruleId: string,
  patch: BookingRulePatchPayload,
) {
  const data = await apiPatch<{ booking_rule: BookingRuleApiRow }>(
    clinicPath(clinicId, `/booking-rules/${ruleId}`),
    patch,
  );
  return data.booking_rule;
}

export async function fetchClinicHours(clinicId: string) {
  const data = await apiGet<{ hours: ClinicHoursApiRow[] }>(clinicPath(clinicId, '/hours'));
  return data.hours.filter((row) => row.active);
}

export async function replaceClinicHours(
  clinicId: string,
  windows: Array<{ day_of_week: number; start_time: string; end_time: string; active: boolean }>,
) {
  const data = await apiPut<{ hours: ClinicHoursApiRow[] }>(clinicPath(clinicId, '/hours'), {
    windows,
  });
  return data.hours;
}

export async function fetchHolidays(clinicId: string) {
  const data = await apiGet<{ holidays: HolidayApiRow[] }>(clinicPath(clinicId, '/holidays'));
  return data.holidays;
}

export async function createHoliday(
  clinicId: string,
  payload: { holiday_date: string; reason?: string; active?: boolean; doctor_ids?: string[] },
) {
  const data = await apiPost<{ holiday: HolidayApiRow }>(
    clinicPath(clinicId, '/holidays'),
    payload,
  );
  return data.holiday;
}

export async function patchHoliday(
  clinicId: string,
  holidayId: string,
  payload: Partial<{ holiday_date: string; reason: string; active: boolean; doctor_ids: string[] }>,
) {
  const data = await apiPatch<{ holiday: HolidayApiRow }>(
    clinicPath(clinicId, `/holidays/${holidayId}`),
    payload,
  );
  return data.holiday;
}

export async function fetchDoctorSchedules(clinicId: string, doctorId: string) {
  const data = await apiGet<{ schedules: DoctorScheduleApiRow[] }>(
    clinicPath(clinicId, `/doctors/${doctorId}/schedules`),
  );
  return data.schedules.filter((row) => row.active);
}

export async function replaceDoctorSchedules(
  clinicId: string,
  doctorId: string,
  windows: Array<{ day_of_week: number; start_time: string; end_time: string; active: boolean }>,
) {
  const data = await apiPut<{ schedules: DoctorScheduleApiRow[] }>(
    clinicPath(clinicId, `/doctors/${doctorId}/schedules`),
    { windows },
  );
  return data.schedules;
}

export async function fetchCalls(clinicId: string) {
  const data = await apiGet<{ calls: CallApiRow[] }>(clinicPath(clinicId, '/calls'));
  return data.calls;
}

export type CallbackRequestApiRow = {
  id: string;
  patient_name: string | null;
  patient_phone: string | null;
  reason: string | null;
  status: string;
  source_session_id: string | null;
  source_call_id: string | null;
  created_at: string;
};

export async function fetchCallbackRequests(clinicId: string) {
  const data = await apiGet<{ callback_requests: CallbackRequestApiRow[] }>(
    clinicPath(clinicId, '/callback-requests'),
  );
  return data.callback_requests;
}

export async function searchPatientHistory(
  clinicId: string,
  query: {
    phone?: string;
    name?: string;
    age?: number;
  },
) {
  const params = new URLSearchParams();
  if (query.phone) {
    params.set('phone', query.phone);
  }
  if (query.name) {
    params.set('name', query.name);
  }
  if (query.age !== undefined) {
    params.set('age', String(query.age));
  }

  const suffix = params.toString();
  const path = suffix
    ? clinicPath(clinicId, `/patients/history?${suffix}`)
    : clinicPath(clinicId, '/patients/history');

  const data = await apiGet<{ patients: PatientHistoryApiRow[] }>(path);
  return data.patients;
}

export async function fetchPlatformNotifications() {
  const data = await apiGet<{ notifications: unknown[] }>('/internal/platform/notifications');
  return data.notifications;
}

export async function fetchPlatformJobHealth() {
  return apiGet<{
    health: Array<{ status: string; count: number }>;
    recent_runs: Array<Record<string, unknown>>;
  }>('/internal/platform/jobs/health');
}
