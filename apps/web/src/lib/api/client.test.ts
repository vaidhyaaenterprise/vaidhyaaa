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
    vi.useRealTimers();
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
    expect(options.cache).toBe('no-store');
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

  it('retries a timed-out read once before reporting failure', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => toApiSuccessBody({ ok: true }, 'req_timeout_retry'),
      });
    vi.stubGlobal('fetch', fetchMock);

    const request = apiGet<{ ok: boolean }>('/v1/timeout-retry');
    await vi.advanceTimersByTimeAsync(20_150);

    await expect(request).resolves.toEqual({ ok: true });
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

  it('does not let an older read discard a newer post-mutation in-flight read', async () => {
    let releaseFirstRead: (() => void) | undefined;
    let releaseSecondRead: (() => void) | undefined;
    const firstReadReady = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    const secondReadReady = new Promise<void>((resolve) => {
      releaseSecondRead = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstReadReady;
        return {
          ok: true,
          status: 200,
          json: async () => toApiSuccessBody({ version: 'old' }, 'req_old_read'),
        };
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => toApiSuccessBody({ saved: true }, 'req_mutation'),
      })
      .mockImplementationOnce(async () => {
        await secondReadReady;
        return {
          ok: true,
          status: 200,
          json: async () => toApiSuccessBody({ version: 'new' }, 'req_new_read'),
        };
      });
    vi.stubGlobal('fetch', fetchMock);

    const oldRead = apiGet<{ version: string }>('/v1/resource');
    await apiPost('/v1/resource', { value: true });
    const newRead = apiGet<{ version: string }>('/v1/resource');

    releaseFirstRead?.();
    await expect(oldRead).resolves.toEqual({ version: 'old' });
    const deduplicatedRead = apiGet<{ version: string }>('/v1/resource');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    releaseSecondRead?.();
    await expect(Promise.all([newRead, deduplicatedRead])).resolves.toEqual([
      { version: 'new' },
      { version: 'new' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a failed mutation that might already have been applied', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network failure'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPost('/v1/save', { value: true })).rejects.toBeInstanceOf(ApiRequestError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries an explicitly repeatable mutation after a transient service failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers({ 'retry-after': '0' }),
        json: async () => null,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => toApiSuccessBody({ access_token: 'token' }, 'req_login_retry'),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiPost<{ access_token: string }>(
        '/v1/auth/login',
        { username: 'admin', password: 'secret' },
        { retryTransient: true },
      ),
    ).resolves.toEqual({ access_token: 'token' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it('does not expose a structured server error message or details', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () =>
        apiErrorBodySchema.parse({
          error: {
            code: 'INTERNAL_ERROR',
            message:
              '(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15',
            details: { database_host: 'private-database-host' },
            request_id: 'req_database_pool',
          },
        }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPost('/v1/auth/login', {})).rejects.toMatchObject({
      apiError: {
        code: 'INTERNAL_ERROR',
        message: 'The service is temporarily unavailable. Please try again shortly.',
        requestId: 'req_database_pool',
        details: {},
      },
    });
  });

  it('sanitizes malformed server errors while retaining available diagnostics', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: '(EMAXCONNSESSION) max clients reached',
      headers: new Headers({ 'x-request-id': 'req_response_header' }),
      json: async () => ({
        error: {
          code: 'DATABASE_CONNECTION_EXHAUSTED',
          message: '(EMAXCONNSESSION) max clients reached',
          details: 'invalid-details-shape',
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPost('/v1/auth/login', {})).rejects.toMatchObject({
      apiError: {
        code: 'DATABASE_CONNECTION_EXHAUSTED',
        message: 'The service is temporarily unavailable. Please try again shortly.',
        requestId: 'req_response_header',
        details: {},
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
