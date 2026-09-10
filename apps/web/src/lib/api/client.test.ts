import { apiErrorBodySchema, toApiSuccessBody } from '@vaidya/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError, apiGet, getApiBaseUrl } from '@/lib/api/client';
import { DEV_AUTH_STORAGE_KEY, DEV_AUTH_PRESETS } from '@/lib/dev-auth/constants';

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('uses NEXT_PUBLIC_API_BASE_URL and dev auth headers', async () => {
    window.localStorage.setItem(
      DEV_AUTH_STORAGE_KEY,
      JSON.stringify(DEV_AUTH_PRESETS.clinic_admin.profile),
    );

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () =>
        toApiSuccessBody(
          {
            user: { id: 'user-1', name: 'Admin', active: true },
            clinics: [],
          },
          'req_test',
        ),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await apiGet('/v1/me');

    expect(fetchMock).toHaveBeenCalledOnce();
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]).toBeDefined();
    const [url, options] = calls[0]!;
    expect(url).toContain('/v1/me');
    expect(options.headers).toMatchObject({
      'x-dev-user-id': DEV_AUTH_PRESETS.clinic_admin.profile.userId,
      'x-dev-user-role': 'clinic_admin',
      'x-dev-clinic-id': DEV_AUTH_PRESETS.clinic_admin.profile.clinicId,
    });
  });

  it('throws ApiRequestError with standard API error message', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () =>
        apiErrorBodySchema.parse({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication is required.',
            details: {},
            request_id: 'req_unauth',
          },
        }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/v1/me')).rejects.toBeInstanceOf(ApiRequestError);
    await expect(apiGet('/v1/me')).rejects.toMatchObject({
      apiError: {
        code: 'UNAUTHORIZED',
        message: 'Authentication is required.',
      },
    });
  });

  it('rewrites localhost API base to current host in development browser mode', () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        hostname: '172.31.19.151',
      },
    });

    expect(getApiBaseUrl()).toBe('http://172.31.19.151:3000');

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });
});
