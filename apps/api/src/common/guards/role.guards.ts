import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { AppError } from '@vaidya/shared';

import { AUTH_CONTEXT_KEY } from './auth.guard';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      [AUTH_CONTEXT_KEY]?: { platformRole?: string };
    }>();
    const auth = request[AUTH_CONTEXT_KEY];

    if (auth?.platformRole !== 'platform_admin') {
      throw new AppError('FORBIDDEN', 'Platform admin access is required.');
    }

    return true;
  }
}

@Injectable()
export class ClinicAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      [AUTH_CONTEXT_KEY]?: { platformRole?: string; clinicRole?: string };
    }>();
    const auth = request[AUTH_CONTEXT_KEY];

    if (auth?.platformRole === 'platform_admin' || auth?.clinicRole === 'clinic_admin') {
      return true;
    }

    throw new AppError('FORBIDDEN', 'Clinic admin access is required.');
  }
}
