import { apiErrorBodySchema, toApiSuccessBody } from '@vaidya/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError, apiGet, apiPost, getApiBaseUrl } from '@/lib/api/client';
import {
  clearDevAuthProfile,
  initializeTabSession,
  writeAccessToken,
  writeDevAuthProfile,
} from '@/lib/dev-auth/storage';

vi.mock('@/lib/dev-auth/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dev-auth/storage')>()),
  initializeTabSession: vi.fn().mockResolvedValue(undefined),
}));
import {
  AUTH_TOKEN_STORAGE_KEY,
  DEV_AUTH_STORAGE_KEY,
  DEV_AUTH_PRESETS,
} from '@/lib/dev-auth/constants';

describe('api client', () => {
  it('rejects a response from a logged-out session even if the next login has an identical token', async () => {
    writeAccessToken('same-token');
    writeDevAuthProfile(DEV_AUTH_PRESETS.doctor.profile);
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = apiGet('/v1/aba-session');
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();
    clearDevAuthProfile();
    writeAccessToken('same-token');
    writeDevAuthProfile(DEV_AUTH_PRESETS.doctor.profile);
    finish(new Response(JSON.stringify(toApiSuccessBody({ private: 'old-session' }, 'req_old'))));
    await rejected;
  });

  afterEach(() => {
    vi.mocked(initializeTabSession).mockReset().mockResolvedValue(undefined);
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
    window.sessionStorage.setItem(
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

  it('does not invent a seed clinic header when the saved profile has no clinic', async () => {
    window.sessionStorage.setItem(
      DEV_AUTH_STORAGE_KEY,
      JSON.stringify({
        userId: '00000000-0000-0000-0000-000000000101',
        role: 'platform_admin',
      }),
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => toApiSuccessBody({ ok: true }, 'req_no_clinic'),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await apiGet('/v1/no-clinic-header');

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[1].headers).toMatchObject({
      'x-dev-user-id': '00000000-0000-0000-0000-000000000101',
      'x-dev-user-role': 'platform_admin',
    });
    expect(calls[0]?.[1].headers).not.toHaveProperty('x-dev-clinic-id');
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

  it('waits for tab session ownership before reading credentials or sending a request', async () => {
    let finishInitialization!: () => void;
    vi.mocked(initializeTabSession).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishInitialization = resolve;
        }),
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => toApiSuccessBody({ ok: true }, 'req_initialized'),
    });
    vi.stubGlobal('fetch', fetchMock);
    const request = apiGet('/v1/initialized');
    expect(fetchMock).not.toHaveBeenCalled();
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'owned-tab-token');
    finishInitialization();
    await expect(request).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]?.[1].headers.Authorization).toBe('Bearer owned-tab-token');
  });

  it('never uses a legacy shared profile when this tab has a different bearer login', async () => {
    window.localStorage.setItem(
      DEV_AUTH_STORAGE_KEY,
      JSON.stringify(DEV_AUTH_PRESETS.clinic_admin.profile),
    );
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'doctor-tab-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => toApiSuccessBody({ ok: true }, 'req_tab_only'),
    });
    vi.stubGlobal('fetch', fetchMock);
    await apiGet('/v1/tab-only');
    const headers = fetchMock.mock.calls[0]?.[1].headers;
    expect(headers.Authorization).toBe('Bearer doctor-tab-token');
    expect(headers).not.toHaveProperty('x-dev-user-id');
    expect(headers).not.toHaveProperty('x-dev-user-role');
  });

  it('discards a response body if logout or a new login occurs while it is being decoded', async () => {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'first-login');
    let finishBody!: (body: unknown) => void;
    let bodyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      bodyStarted = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => {
          bodyStarted();
          return new Promise((resolve) => {
            finishBody = resolve;
          });
        },
      }),
    );
    const request = apiGet('/v1/old-account');
    await started;
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'replacement-login');
    finishBody(toApiSuccessBody({ private: 'first-account-data' }, 'req_old_account'));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not resend old credentials after the session changes during a retry delay', async () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'old-login');
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('temporary network failure'));
    vi.stubGlobal('fetch', fetchMock);
    const request = apiGet('/v1/retry-old-account');
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'new-login');
    await vi.advanceTimersByTimeAsync(200);
    await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('ignores an old unauthorized response after a new login', async () => {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'old-account');
    let finishResponse!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishResponse = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const request = apiGet('/v1/late-auth-error');
    await Promise.resolve();
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'new-account');
    finishResponse({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: 'UNAUTHORIZED', message: 'Expired', details: {}, request_id: 'req_expired' },
      }),
    } as Response);
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('new-account');
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

  it('does not start a retry after the last GET consumer cancels', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network failure'));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const request = apiGet('/v1/cancel-before-retry', controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledOnce();
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

  it('does not share an in-flight GET across different role or doctor contexts', async () => {
    let releaseResponses: (() => void) | undefined;
    const responsesReady = new Promise<void>((resolve) => {
      releaseResponses = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await responsesReady;
      return {
        ok: true,
        status: 200,
        json: async () => toApiSuccessBody({ ok: true }, 'req_role_scoped'),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const sharedIdentity = {
      userId: '00000000-0000-0000-0000-000000000555',
      clinicId: '00000000-0000-0000-0000-000000000001',
    };

    window.sessionStorage.setItem(
      DEV_AUTH_STORAGE_KEY,
      JSON.stringify({ ...sharedIdentity, role: 'clinic_admin' }),
    );
    const adminRequest = apiGet('/v1/role-scoped');
    await Promise.resolve();

    window.sessionStorage.setItem(
      DEV_AUTH_STORAGE_KEY,
      JSON.stringify({
        ...sharedIdentity,
        role: 'doctor',
        doctorId: '00000000-0000-0000-0000-000000000202',
      }),
    );
    const doctorRequest = apiGet('/v1/role-scoped');
    releaseResponses?.();

    await expect(adminRequest).rejects.toMatchObject({ name: 'AbortError' });
    await expect(doctorRequest).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels a GET when its only consumer aborts', async () => {
    let underlyingSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      underlyingSignal = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const request = apiGet('/v1/cancel-single', controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(underlyingSignal?.aborted).toBe(true);
  });

  it('keeps a shared GET alive when only one consumer aborts', async () => {
    let releaseResponse: (() => void) | undefined;
    let underlyingSignal: AbortSignal | undefined;
    const responseReady = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      underlyingSignal = init.signal ?? undefined;
      await responseReady;
      return {
        ok: true,
        status: 200,
        json: async () => toApiSuccessBody({ ok: true }, 'req_shared_partial_abort'),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const firstController = new AbortController();

    const first = apiGet('/v1/shared-cancel', firstController.signal);
    const second = apiGet<{ ok: boolean }>('/v1/shared-cancel');
    await Promise.resolve();
    firstController.abort();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(underlyingSignal?.aborted).toBe(false);

    releaseResponse?.();
    await expect(second).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('aborts a shared GET after all consumers abort and lets the next caller start fresh', async () => {
    let firstUnderlyingSignal: AbortSignal | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        firstUnderlyingSignal = init.signal ?? undefined;
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
        json: async () => toApiSuccessBody({ version: 'fresh' }, 'req_after_all_abort'),
      });
    vi.stubGlobal('fetch', fetchMock);
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = apiGet('/v1/all-cancel', firstController.signal);
    const second = apiGet('/v1/all-cancel', secondController.signal);
    await Promise.resolve();
    firstController.abort();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstUnderlyingSignal?.aborted).toBe(false);

    secondController.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstUnderlyingSignal?.aborted).toBe(true);

    await expect(apiGet('/v1/all-cancel')).resolves.toEqual({ version: 'fresh' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
