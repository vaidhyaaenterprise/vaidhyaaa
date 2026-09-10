/** Seed IDs aligned with infra/sql/002_seed_minimal_qa.sql and api test constants. */
export const DEV_SEED = {
  CLINIC_ID: '00000000-0000-0000-0000-000000000001',
  CLINIC_NAME: 'Sri Murugan Clinic',
  PLATFORM_ADMIN_ID: '00000000-0000-0000-0000-000000000101',
  CLINIC_ADMIN_ID: '00000000-0000-0000-0000-000000000102',
  DOCTOR_PRIYA_USER_ID: '00000000-0000-0000-0000-000000000103',
  DOCTOR_PRIYA_ID: '00000000-0000-0000-0000-000000000202',
} as const;

export const DEV_AUTH_HEADERS = {
  USER_ID: 'x-dev-user-id',
  CLINIC_ID: 'x-dev-clinic-id',
  USER_ROLE: 'x-dev-user-role',
  DOCTOR_ID: 'x-dev-doctor-id',
} as const;

export type DevAuthRole = 'platform_admin' | 'clinic_admin' | 'doctor';

export type DevAuthProfile = {
  userId: string;
  clinicId?: string;
  role: DevAuthRole;
  doctorId?: string;
};

export const DEV_AUTH_STORAGE_KEY = 'vaidya_dev_auth';

export const DEV_AUTH_PRESETS: Record<
  DevAuthRole,
  { label: string; profile: DevAuthProfile }
> = {
  platform_admin: {
    label: 'Platform admin',
    profile: {
      userId: DEV_SEED.PLATFORM_ADMIN_ID,
      clinicId: DEV_SEED.CLINIC_ID,
      role: 'platform_admin',
    },
  },
  clinic_admin: {
    label: 'Clinic admin',
    profile: {
      userId: DEV_SEED.CLINIC_ADMIN_ID,
      clinicId: DEV_SEED.CLINIC_ID,
      role: 'clinic_admin',
    },
  },
  doctor: {
    label: 'Doctor (Dr. Priya)',
    profile: {
      userId: DEV_SEED.DOCTOR_PRIYA_USER_ID,
      clinicId: DEV_SEED.CLINIC_ID,
      role: 'doctor',
      doctorId: DEV_SEED.DOCTOR_PRIYA_ID,
    },
  },
};
