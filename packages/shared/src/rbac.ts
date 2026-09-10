import { z } from 'zod';

import { clinicRoleSchema, platformRoleSchema } from './enums/user-roles';

export { clinicRoleSchema, platformRoleSchema } from './enums/user-roles';
export type { ClinicRole, PlatformRole } from './enums/user-roles';

export const authContextSchema = z.object({
  userId: z.string().uuid(),
  platformRole: platformRoleSchema.optional(),
  clinicId: z.string().uuid().optional(),
  clinicRole: clinicRoleSchema.optional(),
  doctorId: z.string().uuid().optional(),
});

export type AuthContext = z.infer<typeof authContextSchema>;

export function canAccessClinic(auth: AuthContext, clinicId: string): boolean {
  if (auth.platformRole === 'platform_admin' || auth.platformRole === 'support') {
    return true;
  }
  return auth.clinicId === clinicId;
}
