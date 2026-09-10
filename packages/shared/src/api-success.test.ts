import { describe, expect, it } from 'vitest';

import { apiSuccessBodySchema, toApiSuccessBody } from './api-success';

describe('api success shape', () => {
  it('matches the standard API success format', () => {
    const body = toApiSuccessBody({ status: 'ok' }, 'req_test123');

    const parsed = apiSuccessBodySchema.parse(body);
    expect(parsed.data).toEqual({ status: 'ok' });
    expect(parsed.meta.request_id).toBe('req_test123');
    expect(parsed.meta.debug).toBeNull();
  });
});
