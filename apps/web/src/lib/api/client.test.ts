import { apiErrorBodySchema, toApiSuccessBody } from '@vaidya/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError, apiGet, apiPost, getApiBaseUrl } from '@/lib/api/client';
import {
  AUTH_TOKEN_STORAGE_KEY,
  DEV_AUTH_STORAGE_KEY,
  DEV_AUTH_PRESETS,
} from '@/lib/dev-auth/constants';

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('always uses the same-origin API proxy', () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');

    expect(getApiBaseUrl()).toBe('/api/backend');
  });

  it('uses the API proxy and dev auth headers', async () => {
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
    expect(options.credentials).toBe('include');
  });

  it('adds the saved bearer token to production-compatible requests', async () => {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'access-token');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => toApiSuccessBody({ ok: true }, 'req_token'),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await apiGet('/v1/token-check');

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[1].headers).toMatchObject({ Authorization: 'Bearer access-token' });
  });

  it('retries a transient GET network failure once', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network failure'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => toApiSuccessBody({ ok: true }, 'req_retry'),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet<{ ok: boolean }>('/v1/retry')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('deduplicates identical GET requests that are already in flight', async () => {
    let releaseResponse: (() => void) | undefined;
    const responseReady = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await responseReady;
      return {
        ok: true,
        status: 200,
        json: async () => toApiSuccessBody({ ok: true }, 'req_deduplicated'),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = apiGet('/v1/shared');
    const second = apiGet('/v1/shared');
    releaseResponse?.();

    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not retry a failed mutation that might already have been applied', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network failure'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPost('/v1/save', { value: true })).rejects.toBeInstanceOf(ApiRequestError);
    expect(fetchMock).toHaveBeenCalledOnce();
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

  it('does not expose a configured upstream API URL to the browser', () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        hostname: '172.31.19.151',
      },
    });

    expect(getApiBaseUrl()).toBe('/api/backend');

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });
});
