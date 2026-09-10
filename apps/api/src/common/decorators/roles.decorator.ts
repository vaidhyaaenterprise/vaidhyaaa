import { SetMetadata } from '@nestjs/common';

import { type ClinicRole, type PlatformRole } from '@vaidya/shared';

export const ROLES_KEY = 'roles';

export type AllowedRole = ClinicRole | PlatformRole;

export const Roles = (...roles: AllowedRole[]) => SetMetadata(ROLES_KEY, roles);
