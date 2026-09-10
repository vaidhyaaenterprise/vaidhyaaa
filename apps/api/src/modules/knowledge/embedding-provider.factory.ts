import { createHash } from 'node:crypto';

import { type ApiEnv } from '@vaidya/config';
import type { EmbeddingInput, EmbeddingProvider, EmbeddingResult } from '@vaidya/shared';

import { GeminiEmbeddingProvider } from './gemini-embedding-provider';
import { NvidiaEmbeddingProvider } from './nvidia-embedding-provider';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function embedToken(token: string, dimension: number): number {
  const hash = createHash('sha256').update(`${token}:${dimension}`).digest();
  return (hash[0]! / 255) * 2 - 1;
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude <= 0) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}

export function buildDeterministicEmbedding(text: string, dimensions: number): number[] {
  const tokens = tokenize(text);
  const vector = new Array<number>(dimensions).fill(0);

  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      vector[dimension] = (vector[dimension] ?? 0) + embedToken(token, dimension);
    }
  }

  return normalizeVector(vector);
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly model: string,
    private readonly dimensions: number,
    private readonly failKnowledgeIds: Set<string> = new Set(),
  ) {}

  async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    if (input.knowledgeId && this.failKnowledgeIds.has(input.knowledgeId)) {
      throw new Error('mock_embedding_provider_forced_failure');
    }

    return {
      vector: buildDeterministicEmbedding(input.text, this.dimensions),
      model: this.model,
      dimensions: this.dimensions,
    };
  }
}

export function createEmbeddingProvider(env: ApiEnv): EmbeddingProvider {
  const failIds = new Set(
    (env.EMBEDDING_MOCK_FAIL_KNOWLEDGE_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );

  if (env.EMBEDDING_PROVIDER === 'mock') {
    return new MockEmbeddingProvider(env.EMBEDDING_MODEL, env.EMBEDDING_DIMENSIONS, failIds);
  }

  if (env.EMBEDDING_PROVIDER === 'gemini') {
    if (!env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is required when EMBEDDING_PROVIDER=gemini');
    }
    return new GeminiEmbeddingProvider(env.GEMINI_API_KEY, env.EMBEDDING_MODEL, env.EMBEDDING_DIMENSIONS);
  }

  if (env.EMBEDDING_PROVIDER === 'nvidia') {
    if (!env.NVIDIA_API_KEY) {
      throw new Error('NVIDIA_API_KEY is required when EMBEDDING_PROVIDER=nvidia');
    }
    return new NvidiaEmbeddingProvider(
      env.NVIDIA_API_KEY,
      env.EMBEDDING_MODEL,
      env.EMBEDDING_DIMENSIONS,
      env.NVIDIA_API_BASE_URL,
    );
  }

  throw new Error(`Embedding provider not implemented: ${env.EMBEDDING_PROVIDER}`);
}
