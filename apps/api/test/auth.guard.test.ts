import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { type ApiEnv } from '@vaidya/config';

import { AuthGuard } from '../src/common/guards/auth.guard';
import { AuthService } from '../src/modules/auth/auth.service';

function createContext(isPublic = false): ExecutionContext {
  const request: Record<string, unknown> = { headers: {} };
  const reflector = new Reflector();
  reflector.getAllAndOverride = () => isPublic;

  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function createAuthServiceMock(): AuthService {
  return {
    authenticateDevRequest: vi.fn().mockResolvedValue({ userId: 'user-1' }),
    authenticateBearerToken: vi.fn(),
  } as unknown as AuthService;
}

describe('AuthGuard', () => {
  it('allows public routes without credentials', async () => {
    const reflector = {
      getAllAndOverride: () => true,
    } as unknown as Reflector;

    const guard = new AuthGuard(
      reflector,
      { AUTH_MODE: 'otp', NODE_ENV: 'test' } as ApiEnv,
      createAuthServiceMock(),
    );
    await expect(guard.canActivate(createContext(true))).resolves.toBe(true);
  });

  it('rejects unauthenticated requests when auth is required', async () => {
    const guard = new AuthGuard(
      new Reflector(),
      {
        AUTH_MODE: 'otp',
        NODE_ENV: 'test',
      } as ApiEnv,
      createAuthServiceMock(),
    );

    await expect(guard.canActivate(createContext(false))).rejects.toThrow(UnauthorizedException);
  });

  it('uses dev auth locally', async () => {
    const authService = createAuthServiceMock();
    const guard = new AuthGuard(
      new Reflector(),
      {
        AUTH_MODE: 'dev',
        NODE_ENV: 'development',
        APP_ENV: 'local',
      } as ApiEnv,
      authService,
    );

    await expect(guard.canActivate(createContext(false))).resolves.toBe(true);
    expect(authService.authenticateDevRequest).toHaveBeenCalled();
  });
});
