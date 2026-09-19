import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { ApiErrorBody, AppError, REQUEST_ID_HEADER } from '@vaidya/shared';

import { REQUEST_ID_CONTEXT_KEY } from '../src/common/constants';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { AppLogger } from '../src/common/logger/logger.service';

const SAFE_INTERNAL_ERROR_MESSAGE =
  'The service is temporarily unavailable. Please try again shortly.';

type ReplyMock = {
  status: ReturnType<typeof vi.fn>;
  header: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

function createHost(requestId = 'req_filter_test'): {
  host: ArgumentsHost;
  reply: ReplyMock;
} {
  const reply: ReplyMock = {
    status: vi.fn(),
    header: vi.fn(),
    send: vi.fn(),
  };
  reply.status.mockReturnValue(reply);
  reply.header.mockReturnValue(reply);
  reply.send.mockReturnValue(reply);

  const request = {
    raw: {
      [REQUEST_ID_CONTEXT_KEY]: requestId,
    },
  } as unknown as FastifyRequest;

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply as unknown as FastifyReply,
    }),
  } as unknown as ArgumentsHost;

  return { host, reply };
}

function createFilter(): {
  filter: AllExceptionsFilter;
  logError: ReturnType<typeof vi.fn>;
} {
  const logError = vi.fn();
  const logger = { error: logError } as unknown as AppLogger;
  return {
    filter: new AllExceptionsFilter(logger),
    logError,
  };
}

function getSentBody(reply: ReplyMock): ApiErrorBody {
  return reply.send.mock.calls[0]?.[0] as ApiErrorBody;
}

describe('AllExceptionsFilter', () => {
  it('does not expose raw database connection errors and logs them with the request ID', () => {
    const { filter, logError } = createFilter();
    const { host, reply } = createHost('req_db_pool_exhausted');
    const sensitiveMessage =
      '(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15';

    filter.catch(new Error(sensitiveMessage), host);

    expect(reply.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(reply.header).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'req_db_pool_exhausted');
    expect(getSentBody(reply)).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: SAFE_INTERNAL_ERROR_MESSAGE,
        details: {},
        request_id: 'req_db_pool_exhausted',
      },
    });
    expect(JSON.stringify(getSentBody(reply))).not.toContain(sensitiveMessage);
    expect(logError).toHaveBeenCalledWith(
      `[req_db_pool_exhausted] ${sensitiveMessage}`,
      expect.stringContaining(sensitiveMessage),
      'AllExceptionsFilter',
    );
  });

  it('sanitizes 5xx HttpException messages', () => {
    const { filter, logError } = createFilter();
    const { host, reply } = createHost('req_http_503');
    const sensitiveMessage = 'upstream database host and password were rejected';

    filter.catch(
      new HttpException({ message: sensitiveMessage }, HttpStatus.SERVICE_UNAVAILABLE),
      host,
    );

    expect(reply.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(getSentBody(reply)).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: SAFE_INTERNAL_ERROR_MESSAGE,
        details: {},
        request_id: 'req_http_503',
      },
    });
    expect(JSON.stringify(getSentBody(reply))).not.toContain(sensitiveMessage);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining(sensitiveMessage),
      expect.any(String),
      'AllExceptionsFilter',
    );
  });

  it('sanitizes 5xx AppError messages and details while preserving its code', () => {
    const { filter, logError } = createFilter();
    const { host, reply } = createHost('req_provider_failure');
    const sensitiveMessage = 'Provider returned secret diagnostic output';

    filter.catch(
      new AppError('PROVIDER_FAILURE', sensitiveMessage, {
        provider_response: 'private provider response',
      }),
      host,
    );

    expect(reply.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    expect(getSentBody(reply)).toEqual({
      error: {
        code: 'PROVIDER_FAILURE',
        message: SAFE_INTERNAL_ERROR_MESSAGE,
        details: {},
        request_id: 'req_provider_failure',
      },
    });
    expect(JSON.stringify(getSentBody(reply))).not.toContain('private provider response');
    expect(logError).toHaveBeenCalledWith(
      `[req_provider_failure] ${sensitiveMessage}`,
      expect.any(String),
      'AllExceptionsFilter',
    );
  });

  it('preserves AppError messages and details for 4xx responses', () => {
    const { filter, logError } = createFilter();
    const { host, reply } = createHost('req_slot_full');

    filter.catch(
      new AppError('SLOT_FULL', 'The selected slot is full.', {
        slot_id: 'slot-123',
      }),
      host,
    );

    expect(reply.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(getSentBody(reply)).toEqual({
      error: {
        code: 'SLOT_FULL',
        message: 'The selected slot is full.',
        details: { slot_id: 'slot-123' },
        request_id: 'req_slot_full',
      },
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it('preserves validation field details for 4xx HttpExceptions', () => {
    const { filter, logError } = createFilter();
    const { host, reply } = createHost('req_validation');
    const fields = ['email must be an email', 'password must be longer'];

    filter.catch(new HttpException({ message: fields }, HttpStatus.BAD_REQUEST), host);

    expect(reply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(getSentBody(reply)).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed.',
        details: { fields },
        request_id: 'req_validation',
      },
    });
    expect(logError).not.toHaveBeenCalled();
  });
});
