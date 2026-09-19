import { describe, expect, it, vi } from 'vitest';

import { fetchWithRetry } from '../src/common/http/fetch-with-retry';

describe('fetchWithRetry', () => {
  it('retries a retryable provider response once', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const response = await fetchWithRetry(
      fetchImpl,
      'https://provider.example.test/embedding',
      { method: 'POST' },
      { timeoutMs: 1_000, retryDelayMs: 0 },
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient provider errors', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 400 }));

    const response = await fetchWithRetry(
      fetchImpl,
      'https://provider.example.test/embedding',
      { method: 'POST' },
      { timeoutMs: 1_000, retryDelayMs: 0 },
    );

    expect(response.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('bounds an unresponsive provider request with a timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    });

    await expect(
      fetchWithRetry(
        fetchImpl,
        'https://provider.example.test/embedding',
        { method: 'POST' },
        { timeoutMs: 5, maxAttempts: 1, retryDelayMs: 0 },
      ),
    ).rejects.toThrow('Provider request timed out after 5ms.');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('honours caller cancellation without retrying', async () => {
    const caller = new AbortController();
    caller.abort();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    await expect(
      fetchWithRetry(
        fetchImpl,
        'https://provider.example.test/embedding',
        { method: 'POST', signal: caller.signal },
        { timeoutMs: 1_000, retryDelayMs: 0 },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
