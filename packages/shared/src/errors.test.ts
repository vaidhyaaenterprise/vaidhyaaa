import { describe, expect, it } from 'vitest';

import {
  apiErrorBodySchema,
  createRequestId,
  statusCodeForErrorCode,
  toApiErrorBody,
} from './errors/index';

describe('api error shape', () => {
  it('matches the standard API error format', () => {
    const body = toApiErrorBody('VALIDATION_ERROR', 'Human readable message.', 'req_test123', {
      field: 'name',
    });

    const parsed = apiErrorBodySchema.parse(body);
    expect(parsed.error.code).toBe('VALIDATION_ERROR');
    expect(parsed.error.message).toBe('Human readable message.');
    expect(parsed.error.request_id).toBe('req_test123');
    expect(parsed.error.details).toEqual({ field: 'name' });
  });
});

describe('statusCodeForErrorCode', () => {
  it('maps DOCTOR_NOT_OWNER to 403 per LLD', () => {
    expect(statusCodeForErrorCode('DOCTOR_NOT_OWNER')).toBe(403);
  });

  it('maps slot conflicts to 409 per LLD', () => {
    expect(statusCodeForErrorCode('SLOT_NOT_AVAILABLE')).toBe(409);
    expect(statusCodeForErrorCode('SLOT_HOLD_EXPIRED')).toBe(409);
  });
});

describe('createRequestId', () => {
  it('returns a req_ prefixed id', () => {
    const requestId = createRequestId();

    expect(requestId).toMatch(/^req_[0-9a-f]{16}$/);
  });
});
