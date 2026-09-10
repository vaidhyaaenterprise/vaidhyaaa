import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { type ApiEnv } from '@vaidya/config';
import { isApiErrorBody, toApiSuccessBody } from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';
import { SKIP_API_ENVELOPE_KEY } from '../decorators/skip-api-envelope.decorator';
import { REQUEST_ID_CONTEXT_KEY } from '../constants';

function getRequestId(request: FastifyRequest): string {
  const raw = request.raw as { [REQUEST_ID_CONTEXT_KEY]?: string };
  return raw[REQUEST_ID_CONTEXT_KEY] ?? 'req_unknown';
}

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const skipEnvelope =
      this.reflector.getAllAndOverride<boolean>(SKIP_API_ENVELOPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    return next.handle().pipe(
      map((data: unknown) => {
        if (skipEnvelope || isApiErrorBody(data)) {
          return data;
        }

        if (typeof data === 'string' || Buffer.isBuffer(data)) {
          return data;
        }

        const requestId = getRequestId(request);
        const debug =
          this.env.DEBUG_API && this.env.NODE_ENV !== 'production' ? null : null;

        return toApiSuccessBody(data, requestId, debug);
      }),
    );
  }
}
