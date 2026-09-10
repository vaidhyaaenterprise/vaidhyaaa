import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';

import { type ApiEnv } from '@vaidya/config';
import { AppError, type AuthContext } from '@vaidya/shared';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { API_ENV } from '../../config/api-config.module';
import { AuthService } from '../../modules/auth/auth.service';

export const AUTH_CONTEXT_KEY = 'authContext';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest & {
      [AUTH_CONTEXT_KEY]?: AuthContext;
    }>();

    if (this.env.AUTH_MODE === 'dev') {
      request[AUTH_CONTEXT_KEY] = await this.authService.authenticateDevRequest(request);
      return true;
    }

    const authorization = request.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      request[AUTH_CONTEXT_KEY] = await this.authService.authenticateBearerToken(
        authorization.slice('Bearer '.length),
      );
      return true;
    }

    throw new UnauthorizedException('Authentication is required.');
  }
}

export function getAuthContext(
  request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
): AuthContext {
  const auth = request[AUTH_CONTEXT_KEY];
  if (!auth) {
    throw new AppError('UNAUTHORIZED', 'Authentication is required.');
  }
  return auth;
}
