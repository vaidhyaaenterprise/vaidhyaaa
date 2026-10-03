import type { EmbeddingInput, EmbeddingProvider, EmbeddingResult } from '@vaidya/shared';

import { fetchWithRetry } from '../../common/http/fetch-with-retry';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiEmbedContentResponse = {
  embedding?: { values?: number[] };
};

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number,
    private readonly timeoutMs = 10_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    const url = `${GEMINI_BASE_URL}/models/${this.model}:embedContent`;
    const response = await fetchWithRetry(
      this.fetchImpl,
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          model: `models/${this.model}`,
          content: { parts: [{ text: input.text }] },
          embedContentConfig: {
            outputDimensionality: this.dimensions,
          },
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

    if (values.length !== this.dimensions) {
      throw new Error(
        `Gemini embedding dimension mismatch: expected ${this.dimensions}, received ${values.length}`,
      );
    }

    if (!values.every(Number.isFinite)) {
      throw new Error('Gemini embedding response contains non-finite values');
    }

    const vector = normalizeVector(values);
    return { vector, model: this.model, dimensions: vector.length };
  }
}
