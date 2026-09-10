import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';

import { AppError, type AuthContext } from '@vaidya/shared';

import { CLINIC_ADMIN_KEY, PLATFORM_ADMIN_KEY } from '../decorators/platform-admin.decorator';
import { CLINIC_SCOPED_KEY } from '../decorators/clinic-scoped.decorator';
import { DOCTOR_OWNED_KEY } from '../decorators/doctor-owned.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY, type AllowedRole } from '../decorators/roles.decorator';

import { AUTH_CONTEXT_KEY } from './auth.guard';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest & {
      [AUTH_CONTEXT_KEY]?: AuthContext;
      params?: { clinicId?: string };
    }>();

    const auth = request[AUTH_CONTEXT_KEY];
    if (!auth) {
      throw new AppError('UNAUTHORIZED', 'Authentication is required.');
    }

    const routeClinicId = request.params?.clinicId;
    if (
      routeClinicId &&
      auth.platformRole !== 'platform_admin' &&
      auth.platformRole !== 'support' &&
      auth.clinicId !== routeClinicId
    ) {
      throw new AppError('FORBIDDEN', 'Clinic access denied.');
    }

    const platformAdminOnly = this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (platformAdminOnly && auth.platformRole !== 'platform_admin') {
      throw new AppError('FORBIDDEN', 'Platform admin access is required.');
    }

    const clinicAdminOnly = this.reflector.getAllAndOverride<boolean>(CLINIC_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (
      clinicAdminOnly &&
      auth.platformRole !== 'platform_admin' &&
      auth.clinicRole !== 'clinic_admin'
    ) {
      throw new AppError('FORBIDDEN', 'Clinic admin access is required.');
    }

    const requiredRoles = this.reflector.getAllAndOverride<AllowedRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRoles?.length) {
      const hasRole =
        (auth.platformRole === 'platform_admin' && requiredRoles.includes('platform_admin')) ||
        auth.platformRole === 'support' ||
        (auth.clinicRole !== undefined && requiredRoles.includes(auth.clinicRole));

      if (!hasRole) {
        throw new AppError('FORBIDDEN', 'You do not have permission to perform this action.');
      }
    }

    const clinicScoped = this.reflector.getAllAndOverride<boolean>(CLINIC_SCOPED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (
      clinicScoped &&
      !auth.clinicId &&
      auth.platformRole !== 'platform_admin' &&
      auth.platformRole !== 'support'
    ) {
      throw new AppError('FORBIDDEN', 'Clinic context is required.');
    }

    const doctorOwned = this.reflector.getAllAndOverride<boolean>(DOCTOR_OWNED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (doctorOwned && auth.clinicRole === 'doctor' && !auth.doctorId) {
      throw new AppError('DOCTOR_NOT_OWNER', 'Doctor profile is not linked to this account.');
    }

    return true;
  }
}
