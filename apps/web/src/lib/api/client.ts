import {
  apiErrorBodySchema,
  apiSuccessBodySchema,
  createRequestId,
  REQUEST_ID_HEADER,
} from '@vaidya/shared';

import {
  devAuthHeadersFromProfile,
  readAccessToken,
  readDevAuthProfile,
} from '../dev-auth/storage';
import { DEV_SEED } from '../dev-auth/constants';

import type { ApiClientError } from './types';

export function getApiBaseUrl(): string {
  // Prefer the same-origin server proxy. Unlike a NEXT_PUBLIC value, the upstream
  // API URL can then be changed at runtime without rebuilding the browser bundle.
  const base = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || '/api/backend';

  const normalizedBase = base.replace(/\/$/, '');
  if (typeof window === 'undefined') {
    return normalizedBase;
  }

  try {
    const configured = new URL(normalizedBase);
    const currentHost = window.location.hostname;
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
    const configuredIsLoopback = loopbackHosts.has(configured.hostname);
    const currentIsLoopback = loopbackHosts.has(currentHost);

    if (configuredIsLoopback && !currentIsLoopback) {
      configured.hostname = currentHost;
      return configured.toString().replace(/\/$/, '');
    }
  } catch {
    return normalizedBase;
  }

  return normalizedBase;
}

function buildAuthHeaders(): Record<string, string> {
  const token = readAccessToken();
  const profile = readDevAuthProfile();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (!profile) {
    return headers;
  }
  Object.assign(headers, devAuthHeadersFromProfile(profile));
  if (!headers['x-dev-clinic-id']) {
    headers['x-dev-clinic-id'] = DEV_SEED.CLINIC_ID;
  }
  return headers;
}

const API_REQUEST_TIMEOUT_MS = 20_000;
const GET_RETRY_DELAY_MS = 150;
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const pendingGetRequests = new Map<string, Promise<unknown>>();

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = options.signal;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, API_REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();

  if (callerSignal?.aborted) {
    controller.abort();
  } else {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new ApiRequestError({
        code: 'INTERNAL_ERROR',
        message: 'The API took too long to respond. Please try again.',
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

function getRequestKey(path: string): string {
  const authHeaders = buildAuthHeaders();
  return [
    getApiBaseUrl(),
    path,
    authHeaders.Authorization ?? '',
    authHeaders['x-dev-user-id'] ?? '',
    authHeaders['x-dev-clinic-id'] ?? '',
  ].join('|');
}

function clearPendingGetRequests(): void {
  pendingGetRequests.clear();
}

export class ApiRequestError extends Error {
  readonly apiError: ApiClientError;

  constructor(apiError: ApiClientError) {
    super(apiError.message);
    this.name = 'ApiRequestError';
    this.apiError = apiError;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = apiErrorBodySchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiRequestError({
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        requestId: parsed.data.error.request_id,
        details: parsed.data.error.details,
      });
    }

    throw new ApiRequestError({
      code: 'INTERNAL_ERROR',
      message: response.statusText || 'Request failed.',
    });
  }

  const parsed = apiSuccessBodySchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiRequestError({
      code: 'INTERNAL_ERROR',
      message: 'Unexpected API response format.',
    });
  }

  return parsed.data.data as T;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const requestId = createRequestId();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    [REQUEST_ID_HEADER]: requestId,
    ...buildAuthHeaders(),
    ...(options.headers as Record<string, string> | undefined),
  };

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const method = (options.method ?? 'GET').toUpperCase();
  const maximumAttempts = method === 'GET' ? 2 : 1;
  let response: Response | null = null;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      response = await fetchWithTimeout(`${getApiBaseUrl()}${path}`, {
        ...options,
        credentials: options.credentials ?? 'include',
        headers,
      });
    } catch (error) {
      if (isAbortError(error) && options.signal?.aborted) {
        throw error;
      }
      if (error instanceof ApiRequestError) {
        throw error;
      }
      if (attempt < maximumAttempts) {
        await delay(GET_RETRY_DELAY_MS);
        continue;
      }
      throw new ApiRequestError({
        code: 'INTERNAL_ERROR',
        message: 'Unable to reach the API. Please check your connection and try again.',
      });
    }

    if (TRANSIENT_HTTP_STATUSES.has(response.status) && attempt < maximumAttempts) {
      await delay(GET_RETRY_DELAY_MS);
      continue;
    }
    break;
  }

  if (!response) {
    throw new ApiRequestError({
      code: 'INTERNAL_ERROR',
      message: 'Unable to reach the API. Please check your connection and try again.',
    });
  }

  return parseResponse<T>(response);
}

export async function apiGet<T>(path: string): Promise<T> {
  const key = getRequestKey(path);
  const existing = pendingGetRequests.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const request = apiRequest<T>(path, { method: 'GET' }).finally(() => {
    pendingGetRequests.delete(key);
  });
  pendingGetRequests.set(key, request);
  return request;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  clearPendingGetRequests();
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return apiRequest<T>(path, init);
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  clearPendingGetRequests();
  const init: RequestInit = { method: 'PUT' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return apiRequest<T>(path, init);
}

export async function apiDelete<T>(path: string): Promise<T> {
  clearPendingGetRequests();
  return apiRequest<T>(path, { method: 'DELETE' });
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  clearPendingGetRequests();
  const init: RequestInit = { method: 'PATCH' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return apiRequest<T>(path, init);
}
