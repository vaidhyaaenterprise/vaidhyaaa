import { describe, expect, it, vi } from 'vitest';

import { GeminiEmbeddingProvider } from '../src/modules/knowledge/gemini-embedding-provider';
import { NvidiaEmbeddingProvider } from '../src/modules/knowledge/nvidia-embedding-provider';

describe('GeminiEmbeddingProvider', () => {
  it('requests the configured output dimensionality and reports the actual vector length', async () => {
    const values = Array.from({ length: 1024 }, (_, index) => index + 1);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ embedding: { values } }), { status: 200 }));
    const provider = new GeminiEmbeddingProvider(
      'test-api-key',
      'gemini-embedding-001',
      1024,
      1000,
      fetchImpl,
    );

    const result = await provider.embed({ text: 'clinic opening hours' });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const request = fetchImpl.mock.calls[0];
    expect(String(request?.[0])).not.toContain('test-api-key');
    expect(new Headers(request?.[1]?.headers).get('x-goog-api-key')).toBe('test-api-key');
    const body = JSON.parse(String(request?.[1]?.body)) as {
      embedContentConfig: { outputDimensionality: number };
    };
    expect(body.embedContentConfig.outputDimensionality).toBe(1024);
    expect(result.dimensions).toBe(1024);
    expect(result.vector).toHaveLength(1024);
    expect(Math.sqrt(result.vector.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1);
  });

  it('rejects a response whose actual dimensions do not match the contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ embedding: { values: new Array<number>(768).fill(1) } }), {
        status: 200,
      }),
    );
    const provider = new GeminiEmbeddingProvider(
      'test-api-key',
      'gemini-embedding-001',
      1024,
      1000,
      fetchImpl,
    );

    await expect(provider.embed({ text: 'clinic opening hours' })).rejects.toThrow(
      'expected 1024, received 768',
    );
  });
});

describe('NvidiaEmbeddingProvider', () => {
  it('rejects vectors shorter than the configured database dimension', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ embedding: new Array<number>(768).fill(1), index: 0 }] }),
          { status: 200 },
        ),
      );
    const provider = new NvidiaEmbeddingProvider(
      'test-api-key',
      'nvidia-model',
      1024,
      undefined,
      1000,
      fetchImpl,
    );

    await expect(provider.embed({ text: 'clinic opening hours' })).rejects.toThrow(
      'expected at least 1024, received 768',
    );
  });
});
