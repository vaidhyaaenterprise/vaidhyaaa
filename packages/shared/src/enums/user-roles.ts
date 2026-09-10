import { z } from 'zod';

export const PLATFORM_ROLES = ['platform_admin', 'support', 'none'] as const;
export const CLINIC_ROLES = ['clinic_admin', 'doctor'] as const;

export const platformRoleSchema = z.enum(PLATFORM_ROLES);
export const clinicRoleSchema = z.enum(CLINIC_ROLES);

export type PlatformRole = z.infer<typeof platformRoleSchema>;
export type ClinicRole = z.infer<typeof clinicRoleSchema>;
