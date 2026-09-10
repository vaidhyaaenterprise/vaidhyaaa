import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

import {
  AppError,
  type ApiErrorCode,
  REQUEST_ID_HEADER,
  toApiErrorBody,
} from '@vaidya/shared';

import { REQUEST_ID_CONTEXT_KEY } from '../constants';
import { AppLogger } from '../logger/logger.service';

function getRequestId(request: FastifyRequest): string {
  const raw = request.raw as { [REQUEST_ID_CONTEXT_KEY]?: string };
  return raw[REQUEST_ID_CONTEXT_KEY] ?? 'req_unknown';
}

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const response = ctx.getResponse<FastifyReply>();

    const requestId = getRequestId(request);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ApiErrorCode = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';
    let details: Record<string, unknown> = {};

    if (exception instanceof AppError) {
      status = exception.statusCode;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const responseBody = exception.getResponse();

      if (typeof responseBody === 'string') {
        message = responseBody;
      } else if (typeof responseBody === 'object' && responseBody !== null) {
        const body = responseBody as Record<string, unknown>;
        message = typeof body.message === 'string' ? body.message : message;
        if (Array.isArray(body.message)) {
          message = 'Validation failed.';
          details = { fields: body.message };
          code = 'VALIDATION_ERROR';
        }
      }

      if (status === HttpStatus.UNAUTHORIZED) {
        code = 'UNAUTHORIZED';
      } else if (status === HttpStatus.FORBIDDEN) {
        code = 'FORBIDDEN';
      } else if (status === HttpStatus.NOT_FOUND) {
        code = 'NOT_FOUND';
      } else if (status === HttpStatus.BAD_REQUEST && code === 'INTERNAL_ERROR') {
        code = 'VALIDATION_ERROR';
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(exception.message, exception.stack, 'AllExceptionsFilter');
    }

    const body = toApiErrorBody(code, message, requestId, details);

    void response.status(status).header(REQUEST_ID_HEADER, requestId).send(body);
  }
}
