import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { AppError } from '@vaidya/shared';

import { CLINIC_SCOPED_KEY } from '../src/common/decorators/clinic-scoped.decorator';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { AUTH_CONTEXT_KEY } from '../src/common/guards/auth.guard';
import { RbacGuard } from '../src/common/guards/rbac.guard';

function createExecutionContext(
  auth: Record<string, unknown> | undefined,
  _metadata: Record<string, unknown>,
): ExecutionContext {
  const request: Record<string, unknown> = {};
  if (auth) {
    request[AUTH_CONTEXT_KEY] = auth;
  }

  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

function createReflector(metadata: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => metadata[key],
  } as unknown as Reflector;
}

describe('RbacGuard', () => {
  it('rejects when auth context is missing', () => {
    const guard = new RbacGuard(createReflector({}));
    const ctx = createExecutionContext(undefined, {});

    expect(() => guard.canActivate(ctx)).toThrow(AppError);
    try {
      guard.canActivate(ctx);
    } catch (error) {
      expect((error as AppError).code).toBe('UNAUTHORIZED');
    }
  });

  it('enforces required clinic role', () => {
    const guard = new RbacGuard(
      createReflector({
        [ROLES_KEY]: ['clinic_admin'],
      }),
    );
    const ctx = createExecutionContext(
      {
        userId: '00000000-0000-4000-8000-000000000001',
        clinicId: '00000000-0000-4000-8000-000000000010',
        clinicRole: 'doctor',
      },
      {},
    );

    expect(() => guard.canActivate(ctx)).toThrow(AppError);
    try {
      guard.canActivate(ctx);
    } catch (error) {
      expect((error as AppError).code).toBe('FORBIDDEN');
    }
  });

  it('requires clinic context when ClinicScoped is set', () => {
    const guard = new RbacGuard(
      createReflector({
        [CLINIC_SCOPED_KEY]: true,
      }),
    );
    const ctx = createExecutionContext(
      {
        userId: '00000000-0000-4000-8000-000000000001',
        clinicRole: 'clinic_admin',
      },
      {},
    );

    expect(() => guard.canActivate(ctx)).toThrow(AppError);
    try {
      guard.canActivate(ctx);
    } catch (error) {
      expect((error as AppError).code).toBe('FORBIDDEN');
    }
  });
});
