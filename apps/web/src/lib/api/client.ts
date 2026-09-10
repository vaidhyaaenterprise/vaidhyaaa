import {
  apiErrorBodySchema,
  apiSuccessBodySchema,
  createRequestId,
  REQUEST_ID_HEADER,
} from '@vaidya/shared';

import { devAuthHeadersFromProfile, readDevAuthProfile } from '../dev-auth/storage';
import { DEV_SEED } from '../dev-auth/constants';

import type { ApiClientError } from './types';

export function getApiBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL is not configured.');
  }

  const normalizedBase = base.replace(/\/$/, '');
  if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') {
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
  const profile = readDevAuthProfile();
  if (!profile) {
    return {};
  }
  const headers = devAuthHeadersFromProfile(profile);
  if (!headers['x-dev-clinic-id']) {
    headers['x-dev-clinic-id'] = DEV_SEED.CLINIC_ID;
  }
  return headers;
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

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
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

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers,
  }).catch(() => {
    throw new ApiRequestError({
      code: 'INTERNAL_ERROR',
      message: 'Unable to reach the API. Check NEXT_PUBLIC_API_BASE_URL and that the API server is running.',
    });
  });

  return parseResponse<T>(response);
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'GET' });
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return apiRequest<T>(path, init);
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: 'PUT' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return apiRequest<T>(path, init);
}

export async function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'DELETE' });
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: 'PATCH' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return apiRequest<T>(path, init);
}
