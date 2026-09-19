import type { EmbeddingInput, EmbeddingProvider, EmbeddingResult } from '@vaidya/shared';

import { fetchWithRetry } from '../../common/http/fetch-with-retry';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiEmbedContentResponse = {
  embedding?: { values?: number[] };
};

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number,
    private readonly timeoutMs = 10_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    const url = `${GEMINI_BASE_URL}/models/${this.model}:embedContent?key=${this.apiKey}`;
    const response = await fetchWithRetry(
      this.fetchImpl,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${this.model}`,
          content: { parts: [{ text: input.text }] },
        }),
      },
      { timeoutMs: this.timeoutMs },
    );

    if (!response.ok) {
      throw new Error(`Gemini embedding API error ${response.status}.`);
    }

    const data = (await response.json()) as GeminiEmbedContentResponse;
    const values = data.embedding?.values;
    if (!values || values.length === 0) {
      throw new Error('Gemini embedding response missing embedding.values');
    }

    return { vector: values, model: this.model, dimensions: this.dimensions };
  }
}
