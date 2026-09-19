const DEFAULT_RETRY_DELAY_MS = 200;
const MAX_RETRY_DELAY_MS = 1_000;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type FetchWithRetryOptions = {
  timeoutMs: number;
  maxAttempts?: number;
  retryDelayMs?: number;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response: Response | null, attempt: number, baseDelayMs: number): number {
  const retryAfter = response?.headers.get('retry-after')?.trim();
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return Math.min(Number(retryAfter) * 1_000, MAX_RETRY_DELAY_MS);
  }
  return Math.min(baseDelayMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

/**
 * Executes an idempotent outbound provider request with a per-attempt timeout
 * and a small, bounded retry budget. Do not use this for requests that can
 * create duplicate side effects.
 */
export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  input: string | URL,
  init: RequestInit,
  options: FetchWithRetryOptions,
): Promise<Response> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const baseDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const callerSignal = init.signal;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
    const abortFromCaller = () => controller.abort();

    if (callerSignal?.aborted) {
      controller.abort();
    } else {
      callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
    }

    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts) {
        return response;
      }
      await response.body?.cancel();
      await delay(retryDelay(response, attempt, baseDelayMs));
    } catch (error) {
      if (callerSignal?.aborted) {
        throw error;
      }
      lastError = timedOut
        ? new Error(`Provider request timed out after ${options.timeoutMs}ms.`)
        : error;
      if (attempt === maxAttempts) {
        throw lastError;
      }
      await delay(retryDelay(null, attempt, baseDelayMs));
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Provider request failed.');
}
