import { apiGet, apiPatch, apiPost } from '@/lib/api/client';

export type AppointmentApiRow = {
  id: string;
  patient_name: string;
  patient_phone: string | null;
  doctor_id: string;
  doctor_name: string;
  clinic_service_id: string;
  service_name: string;
  appointment_start: string;
  appointment_end: string;
  reason_for_visit: string;
  visit_type: 'new' | 'follow_up';
  routing_source: string | null;
  source: 'agent' | 'manual';
  status: string;
  has_history: boolean;
  visit_reason?: string | null;
  examination_notes?: string | null;
  diagnosis?: string | null;
  advice?: string | null;
};

export type AppointmentActionRequestApiRow = {
  id: string;
  appointment_id: string;
  patient_name: string;
  doctor_id: string;
  doctor_name: string;
  clinic_service_id: string;
  service_name: string;
  requested_date: string | null;
  requested_time_preference: string | null;
  requested_new_slot_id: string | null;
  reason: string | null;
  action_type: 'cancel' | 'reschedule';
  status: string;
};

export type AppointmentAvailableSlotApiRow = {
  slot_id: string;
  doctor_id: string;
  clinic_service_id: string;
  appointment_start: string;
  appointment_end: string;
  available_count: number;
};

export async function fetchAppointments(clinicId: string, status?: string[]) {
  const query = status?.length ? `?status=${status.join(',')}` : '';
  const data = await apiGet<{ appointments: AppointmentApiRow[] }>(
    `/v1/clinics/${clinicId}/appointments${query}`,
  );
  return data.appointments;
}

export async function fetchAppointmentActionRequests(clinicId: string) {
  const data = await apiGet<{ action_requests: AppointmentActionRequestApiRow[] }>(
    `/v1/clinics/${clinicId}/appointments/action-requests`,
  );
  return data.action_requests;
}

export async function fetchAvailableAppointmentSlots(
  clinicId: string,
  query: {
    doctor_id: string;
    clinic_service_id: string;
    date: string;
  },
) {
  const params = new URLSearchParams({
    doctor_id: query.doctor_id,
    clinic_service_id: query.clinic_service_id,
    date: query.date,
  });

  const data = await apiGet<{ slots: AppointmentAvailableSlotApiRow[] }>(
    `/v1/clinics/${clinicId}/appointments/available-slots?${params.toString()}`,
  );
  return data.slots;
}

export async function confirmAppointment(clinicId: string, appointmentId: string) {
  return apiPatch<{ appointment: unknown }>(
    `/v1/clinics/${clinicId}/appointments/${appointmentId}/confirm`,
  );
}

export async function cancelAppointment(clinicId: string, appointmentId: string) {
  return apiPatch<{ appointment: unknown }>(
    `/v1/clinics/${clinicId}/appointments/${appointmentId}/cancel`,
  );
}

export type ManualAppointmentPayload = {
  patient_name: string;
  patient_phone?: string;
  patient_age: number;
  patient_date_of_birth?: string;
  slot_id?: string;
  doctor_id: string;
  clinic_service_id: string;
  reason_for_visit: string;
  appointment_start: string;
  appointment_end: string;
  is_followup?: boolean;
  override_reason?: string;
  status?: 'pending_confirmation' | 'confirmed';
};

export async function createManualAppointment(clinicId: string, payload: ManualAppointmentPayload) {
  const data = await apiPost<{ appointment: unknown }>(
    `/v1/clinics/${clinicId}/appointments`,
    payload,
  );
  return data.appointment;
}

export async function markAppointmentVisited(
  clinicId: string,
  appointmentId: string,
  payload: {
    visit_reason: string;
    examination_notes?: string;
    diagnosis?: string;
    advice?: string;
  },
) {
  return apiPatch<{ appointment: unknown; patient_visit: unknown }>(
    `/v1/clinics/${clinicId}/appointments/${appointmentId}/mark-visited`,
    payload,
  );
}

export async function resolveAppointmentActionRequest(
  clinicId: string,
  actionRequestId: string,
  payload: { status: 'approved' | 'rejected'; new_slot_id?: string },
) {
  return apiPatch<{ action_request: unknown; appointment?: unknown }>(
    `/v1/clinics/${clinicId}/appointments/action-requests/${actionRequestId}`,
    payload,
  );
}
