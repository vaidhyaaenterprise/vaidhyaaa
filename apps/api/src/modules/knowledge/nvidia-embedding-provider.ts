import type { EmbeddingInput, EmbeddingProvider, EmbeddingResult } from '@vaidya/shared';

const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1/embeddings';

type NvidiaEmbeddingResponse = {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens: number; total_tokens: number };
};

export class NvidiaEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: input.text,
        input_type: 'passage',
        encoding_format: 'float',
        truncate: 'NONE',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`NVIDIA embedding API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as NvidiaEmbeddingResponse;
    const values = data.data?.[0]?.embedding;
    if (!values || values.length === 0) {
      throw new Error('NVIDIA embedding response missing data[0].embedding');
    }

    if (values.length <= this.dimensions) {
      return { vector: values, model: this.model, dimensions: this.dimensions };
    }

    const sliced = values.slice(0, this.dimensions);
    const norm = Math.sqrt(sliced.reduce((sum, v) => sum + v * v, 0));
    const vector = norm > 0 ? sliced.map((v) => v / norm) : sliced;

    return { vector, model: this.model, dimensions: this.dimensions };
  }
}
