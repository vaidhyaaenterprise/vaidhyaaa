import type { ClinicRole } from '@vaidya/shared';

/** Matches GET /v1/me response shape from auth.service.ts */
export type MeUser = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  platform_role: string | null;
  active: boolean;
};

export type MeClinicMembership = {
  clinic_id: string;
  role: ClinicRole;
  doctor_id: string | null;
  active: boolean;
};

export type MeResponse = {
  user: MeUser;
  clinics: MeClinicMembership[];
};

export type ApiClientError = {
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
};
