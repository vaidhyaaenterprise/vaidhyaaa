import { apiGet, apiPost } from '@/lib/api/client';

export type ClinicUserRow = {
  id: string;
  clinic_id: string;
  user_id: string;
  role: string;
  doctor_id: string | null;
  active: boolean;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    username?: string | null;
    active: boolean;
  };
};

export async function fetchClinicUsers(clinicId: string) {
  const data = await apiGet<{
    users: ClinicUserRow[];
    clinic_login_number?: string | null;
  }>(`/v1/clinics/${clinicId}/users`);
  return data;
}

export type CreateClinicUserLoginPayload = {
  role: 'clinic_admin' | 'doctor';
  login_name: string;
  password: string;
  doctor_id?: string;
};

export async function createClinicUserLogin(clinicId: string, payload: CreateClinicUserLoginPayload) {
  const data = await apiPost<{
    user: { id: string; name: string | null; username: string | null; active: boolean };
    membership: unknown;
  }>(`/v1/clinics/${clinicId}/users`, payload);
  return data;
}

export async function disableClinicUser(clinicId: string, clinicUserId: string) {
  return apiPost<{ membership: unknown }>(
    `/v1/clinics/${clinicId}/users/${clinicUserId}/disable`,
  );
}

export async function enableClinicUser(clinicId: string, clinicUserId: string) {
  return apiPost<{ membership: unknown }>(
    `/v1/clinics/${clinicId}/users/${clinicUserId}/enable`,
  );
}
