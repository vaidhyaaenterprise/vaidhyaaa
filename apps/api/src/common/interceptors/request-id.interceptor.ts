import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { REQUEST_ID_HEADER } from '@vaidya/shared';

import { REQUEST_ID_CONTEXT_KEY } from '../constants';

function getRequestId(request: FastifyRequest): string | undefined {
  const raw = request.raw as { [REQUEST_ID_CONTEXT_KEY]?: string };
  return raw[REQUEST_ID_CONTEXT_KEY];
}

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<FastifyReply>();
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const requestId = getRequestId(request);
    if (requestId) {
      response.header(REQUEST_ID_HEADER, requestId);
    }

    return next.handle().pipe(
      tap(() => {
        if (requestId) {
          response.header(REQUEST_ID_HEADER, requestId);
        }
      }),
    );
  }
}
