import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

import { AppError, type ApiErrorCode, REQUEST_ID_HEADER, toApiErrorBody } from '@vaidya/shared';

import { REQUEST_ID_CONTEXT_KEY } from '../constants';
import { AppLogger } from '../logger/logger.service';

const SAFE_INTERNAL_ERROR_MESSAGE =
  'The service is temporarily unavailable. Please try again shortly.';

function getRequestId(request: FastifyRequest): string {
  const raw = request.raw as { [REQUEST_ID_CONTEXT_KEY]?: string };
  return raw[REQUEST_ID_CONTEXT_KEY] ?? 'req_unknown';
}

function getExceptionLogMessage(exception: unknown, resolvedMessage: string): string {
  if (!(exception instanceof Error)) {
    return resolvedMessage;
  }

  if (exception.message === resolvedMessage) {
    return exception.message;
  }

  return `${exception.message}: ${resolvedMessage}`;
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
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const logMessage = getExceptionLogMessage(exception, message);
      const trace = exception instanceof Error ? exception.stack : undefined;

      this.logger.error(`[${requestId}] ${logMessage}`, trace, 'AllExceptionsFilter');

      message = SAFE_INTERNAL_ERROR_MESSAGE;
      details = {};
    }

    const body = toApiErrorBody(code, message, requestId, details);

    void response.status(status).header(REQUEST_ID_HEADER, requestId).send(body);
  }
}
