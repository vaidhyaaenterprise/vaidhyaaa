import type { EmbeddingInput, EmbeddingProvider, EmbeddingResult } from '@vaidya/shared';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiEmbedContentResponse = {
  embedding?: { values?: number[] };
};

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number,
  ) {}

  async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    const url = `${GEMINI_BASE_URL}/models/${this.model}:embedContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ text: input.text }] },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini embedding API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as GeminiEmbedContentResponse;
    const values = data.embedding?.values;
    if (!values || values.length === 0) {
      throw new Error('Gemini embedding response missing embedding.values');
    }

    return { vector: values, model: this.model, dimensions: this.dimensions };
  }
}
