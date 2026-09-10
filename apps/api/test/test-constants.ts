import { DEV_AUTH_HEADERS } from '../src/common/constants/auth.constants';

export const SEED = {
  CLINIC_ID: '00000000-0000-0000-0000-000000000001',
  PLATFORM_ADMIN_ID: '00000000-0000-0000-0000-000000000101',
  CLINIC_ADMIN_ID: '00000000-0000-0000-0000-000000000102',
  DOCTOR_PRIYA_ID: '00000000-0000-0000-0000-000000000202',
  DOCTOR_PRIYA_USER_ID: '00000000-0000-0000-0000-000000000103',
  DOCTOR_MURUGAN_ID: '00000000-0000-0000-0000-000000000201',
  DOCTOR_KUMAR_ID: '00000000-0000-0000-0000-000000000203',
  GENERAL_SERVICE_ID: '00000000-0000-0000-0000-000000000301',
  ORTHO_SERVICE_ID: '00000000-0000-0000-0000-000000000303',
  MURUGAN_DOCTOR_SERVICE_ID: '00000000-0000-0000-0000-000000000401',
} as const;

export function devAuthHeaders(input: {
  userId: string;
  clinicId?: string;
  role?: 'platform_admin' | 'clinic_admin' | 'doctor';
  doctorId?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    [DEV_AUTH_HEADERS.USER_ID]: input.userId,
  };

  if (input.role) {
    headers[DEV_AUTH_HEADERS.USER_ROLE] = input.role;
  }
  if (input.clinicId) {
    headers[DEV_AUTH_HEADERS.CLINIC_ID] = input.clinicId;
  }
  if (input.doctorId) {
    headers[DEV_AUTH_HEADERS.DOCTOR_ID] = input.doctorId;
  }

  return headers;
}
