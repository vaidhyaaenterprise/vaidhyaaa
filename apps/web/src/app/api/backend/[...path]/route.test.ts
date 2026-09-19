import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

describe('API proxy route', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forwards the request to the server-only API base URL', async () => {
    vi.stubEnv('API_BASE_URL', 'https://api.example.test');
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { ok: true }, meta: { request_id: 'req_test' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const request = new NextRequest('https://web.example.test/api/backend/v1/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_client',
      },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ path: ['v1', 'auth', 'login'] }),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const calls = fetchMock.mock.calls as unknown as Array<[string | URL | Request, RequestInit]>;
    const [url, init] = calls[0]!;
    expect(String(url)).toBe('https://api.example.test/v1/auth/login');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'manual' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    await expect(response.json()).resolves.toMatchObject({ data: { ok: true } });
  });

  it('uses the same-server API default outside Vercel and returns structured failures', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_BASE_URL', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('VERCEL_URL', '');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection refused'));
    vi.stubGlobal('fetch', fetchMock);
    const request = new NextRequest('https://web.example.test/api/backend/v1/health');

    const response = await GET(request, {
      params: Promise.resolve({ path: ['v1', 'health'] }),
    });
    const payload = await response.json();

    expect(fetchMock).toHaveBeenCalledOnce();
    const calls = fetchMock.mock.calls as unknown as Array<[string | URL | Request, RequestInit]>;
    expect(String(calls[0]?.[0])).toBe('http://127.0.0.1:3000/v1/health');
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(payload).toMatchObject({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The service is temporarily unavailable. Please try again shortly.',
      },
    });
  });

  it('fails fast on Vercel when the server-only API URL is missing', async () => {
    vi.stubEnv('API_BASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3000');
    vi.stubEnv('VERCEL', '1');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const request = new NextRequest('https://web.example.test/api/backend/v1/health');

    const response = await GET(request, {
      params: Promise.resolve({ path: ['v1', 'health'] }),
    });
    const payload = await response.json();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The service is temporarily unavailable. Please contact support.',
      },
    });
  });

  it('rejects a loopback API URL on Vercel', async () => {
    vi.stubEnv('API_BASE_URL', 'http://localhost:3000');
    vi.stubEnv('VERCEL', '1');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const request = new NextRequest('https://web.example.test/api/backend/v1/health');

    const response = await GET(request, {
      params: Promise.resolve({ path: ['v1', 'health'] }),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
  });

  it('rejects an upstream that points back to the web application', async () => {
    vi.stubEnv('API_BASE_URL', 'https://web.example.test');
    vi.stubEnv('VERCEL', '1');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const request = new NextRequest('https://web.example.test/api/backend/v1/health');

    const response = await GET(request, {
      params: Promise.resolve({ path: ['v1', 'health'] }),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
  });
});
