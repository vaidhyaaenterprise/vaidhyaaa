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

import type { ApiClientError } from './types';

export function getApiBaseUrl(): string {
  // Browser requests must stay on the web application's origin. The server-side
  // proxy resolves the actual API host, so localhost never refers to the user's
  // browser and changing the upstream does not require rebuilding this bundle.
  return '/api/backend';
}

function buildAuthHeaders(): Record<string, string> {
  const token = readAccessToken();
  const profile = readDevAuthProfile();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (!profile) {
    return headers;
  }
  Object.assign(headers, devAuthHeadersFromProfile(profile));
  return headers;
}

const API_REQUEST_TIMEOUT_MS = 20_000;
const GET_RETRY_DELAY_MS = 150;
const MAX_RETRY_DELAY_MS = 1_000;
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SERVICE_UNAVAILABLE_MESSAGE =
  'The service is temporarily unavailable. Please try again shortly.';
type PendingGetRequest<T> = {
  key: string;
  request: Promise<T>;
  controller: AbortController;
  activeConsumers: number;
  settled: boolean;
};

const pendingGetRequests = new Map<string, PendingGetRequest<unknown>>();

export type ApiRequestPolicy = {
  /**
   * Retry one transient network/server failure. This is automatic for reads
   * and must be explicitly enabled only for mutations that are safe to repeat.
   */
  retryTransient?: boolean;
};

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', handleAbort);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

function retryDelay(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers?.get?.('retry-after')?.trim();
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return Math.min(Number(retryAfter) * 1_000, MAX_RETRY_DELAY_MS);
  }
  return Math.min(GET_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

class ApiRequestTimeoutError extends Error {
  constructor() {
    super('API request timed out.');
    this.name = 'ApiRequestTimeoutError';
  }
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
      throw new ApiRequestTimeoutError();
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
    authHeaders['x-dev-user-role'] ?? '',
    authHeaders['x-dev-doctor-id'] ?? '',
  ].join('|');
}

function clearPendingGetRequests(): void {
  pendingGetRequests.clear();
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }

  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function settlePendingGetRequest<T>(entry: PendingGetRequest<T>): void {
  entry.settled = true;
  if (pendingGetRequests.get(entry.key) === entry) {
    pendingGetRequests.delete(entry.key);
  }
}

function attachGetConsumer<T>(entry: PendingGetRequest<T>, signal?: AbortSignal): Promise<T> {
  entry.activeConsumers += 1;

  return new Promise<T>((resolve, reject) => {
    let completed = false;

    const complete = () => {
      if (completed) {
        return false;
      }
      completed = true;
      entry.activeConsumers -= 1;
      signal?.removeEventListener('abort', handleAbort);
      return true;
    };

    const handleAbort = () => {
      if (!complete()) {
        return;
      }

      reject(createAbortError());

      if (!entry.settled && entry.activeConsumers === 0) {
        // A caller arriving after every existing consumer has cancelled must get
        // a fresh request instead of attaching to an underlying fetch that is
        // already being aborted. The identity check protects a newer request
        // created after a mutation invalidated the deduplication map.
        if (pendingGetRequests.get(entry.key) === entry) {
          pendingGetRequests.delete(entry.key);
        }
        entry.controller.abort();
      }
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
    }

    void entry.request.then(
      (value) => {
        if (complete()) {
          resolve(value);
        }
      },
      (error: unknown) => {
        if (complete()) {
          reject(error);
        }
      },
    );
  });
}

export class ApiRequestError extends Error {
  readonly apiError: ApiClientError;

  constructor(apiError: ApiClientError) {
    super(apiError.message);
    this.name = 'ApiRequestError';
    this.apiError = apiError;
  }
}

function readServerErrorMetadata(
  payload: unknown,
  response: Response,
): Pick<ApiClientError, 'code' | 'requestId'> {
  const error =
    typeof payload === 'object' && payload !== null && 'error' in payload
      ? (payload as { error?: unknown }).error
      : undefined;
  const errorRecord = typeof error === 'object' && error !== null ? error : undefined;
  const code =
    errorRecord && 'code' in errorRecord && typeof errorRecord.code === 'string'
      ? errorRecord.code
      : 'INTERNAL_ERROR';
  const bodyRequestId =
    errorRecord && 'request_id' in errorRecord && typeof errorRecord.request_id === 'string'
      ? errorRecord.request_id
      : undefined;
  const headerRequestId = response.headers?.get?.(REQUEST_ID_HEADER) || undefined;
  const requestId = bodyRequestId || headerRequestId;

  return requestId ? { code, requestId } : { code };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = apiErrorBodySchema.safeParse(payload);
    if (response.status >= 500) {
      const metadata = parsed.success
        ? {
            code: parsed.data.error.code,
            requestId: parsed.data.error.request_id,
          }
        : readServerErrorMetadata(payload, response);

      throw new ApiRequestError({
        ...metadata,
        message: SERVICE_UNAVAILABLE_MESSAGE,
        details: {},
      });
    }

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
  policy: ApiRequestPolicy = {},
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

  const method = (options.method ?? 'GET').toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  const maximumAttempts = isRead || policy.retryTransient ? 2 : 1;
  let response: Response | null = null;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      response = await fetchWithTimeout(`${getApiBaseUrl()}${path}`, {
        ...options,
        cache: options.cache ?? 'no-store',
        credentials: options.credentials ?? 'include',
        headers,
      });
    } catch (error) {
      if (isAbortError(error) && options.signal?.aborted) {
        throw error;
      }
      if (error instanceof ApiRequestTimeoutError) {
        if (attempt < maximumAttempts) {
          await delay(retryDelay(null, attempt), options.signal ?? undefined);
          continue;
        }
        throw new ApiRequestError({
          code: 'INTERNAL_ERROR',
          message: 'The API took too long to respond. Please try again.',
        });
      }
      if (error instanceof ApiRequestError) {
        throw error;
      }
      if (attempt < maximumAttempts) {
        await delay(retryDelay(null, attempt), options.signal ?? undefined);
        continue;
      }
      throw new ApiRequestError({
        code: 'INTERNAL_ERROR',
        message: 'Unable to reach the API. Please check your connection and try again.',
      });
    }

    if (TRANSIENT_HTTP_STATUSES.has(response.status) && attempt < maximumAttempts) {
      try {
        await response.body?.cancel();
      } catch {
        // Releasing a retryable response body is best-effort only.
      }
      await delay(retryDelay(response, attempt), options.signal ?? undefined);
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

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  const key = getRequestKey(path);
  const existing = pendingGetRequests.get(key) as PendingGetRequest<T> | undefined;
  if (existing) {
    return attachGetConsumer(existing, signal);
  }

  const controller = new AbortController();
  const request = apiRequest<T>(path, { method: 'GET', signal: controller.signal });
  const entry: PendingGetRequest<T> = {
    key,
    request,
    controller,
    activeConsumers: 0,
    settled: false,
  };
  pendingGetRequests.set(key, entry);
  void request.then(
    () => settlePendingGetRequest(entry),
    () => settlePendingGetRequest(entry),
  );
  return attachGetConsumer(entry, signal);
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  policy: ApiRequestPolicy = {},
): Promise<T> {
  clearPendingGetRequests();
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return apiRequest<T>(path, init, policy);
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
