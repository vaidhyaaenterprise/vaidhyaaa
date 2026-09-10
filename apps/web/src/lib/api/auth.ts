import { apiPost } from '@/lib/api/client';
import type { MeResponse } from '@/lib/api/types';

export type UsernamePasswordLoginResult = {
  access_token: string;
  user: MeResponse['user'];
  clinics: MeResponse['clinics'];
};

export async function loginWithUsernamePassword(username: string, password: string) {
  return apiPost<UsernamePasswordLoginResult>('/v1/auth/login', { username, password });
}

export type RegisterClinicAdminPayload = {
  clinic_name: string;
  clinic_phone: string;
  address_line1: string;
  city: string;
  state: string;
  country: string;
  zip_code: string;
  admin_name: string;
  admin_email: string;
  admin_phone: string;
  password: string;
  confirm_password: string;
};

export type RegisterClinicAdminResult = {
  email: string;
  clinic_unique_number: number;
};

export async function registerClinicAdmin(payload: RegisterClinicAdminPayload) {
  return apiPost<RegisterClinicAdminResult>('/v1/auth/register', payload);
}

export async function sendVerificationCode(email: string) {
  return apiPost<{ ok: true }>('/v1/auth/send-verification-code', { email });
}

export async function resendVerificationCode(email: string) {
  return apiPost<{ ok: true }>('/v1/auth/resend-verification-code', { email });
}

export async function verifyEmail(email: string, otp: string) {
  return apiPost<{ ok: true }>('/v1/auth/verify-email', { email, otp });
}

export async function forgotPassword(email: string) {
  return apiPost<{ ok: true }>('/v1/auth/forgot-password', { email });
}

export async function resendPasswordResetCode(email: string) {
  return apiPost<{ ok: true }>('/v1/auth/resend-password-reset-code', { email });
}

export async function verifyPasswordResetCode(email: string, otp: string) {
  return apiPost<{ ok: true }>('/v1/auth/verify-password-reset-code', { email, otp });
}

export async function resetPassword(email: string, otp: string, newPassword: string) {
  return apiPost<{ ok: true }>('/v1/auth/reset-password', {
    email,
    otp,
    new_password: newPassword,
    confirm_password: newPassword,
  });
}
