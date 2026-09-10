import { SetMetadata } from '@nestjs/common';

export const PLATFORM_ADMIN_KEY = 'platformAdmin';
export const CLINIC_ADMIN_KEY = 'clinicAdmin';

/** Requires platform_admin role (not clinic-scoped). */
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN_KEY, true);

/** Requires clinic_admin role for the active clinic context. */
export const ClinicAdmin = () => SetMetadata(CLINIC_ADMIN_KEY, true);
