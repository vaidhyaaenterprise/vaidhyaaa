import { describe, expect, it, vi } from 'vitest';

import type { ApiEnv } from '@vaidya/config';
import type { KnowledgeSearchResult } from '@vaidya/shared';

import { HybridKnowledgeSearchTool } from '../src/modules/knowledge/knowledge-search-tools/hybrid-knowledge-search.tool';
import { PgVectorKnowledgeSearchTool } from '../src/modules/knowledge/knowledge-search-tools/pgvector-knowledge-search.tool';
import { SimpleTextKnowledgeSearchTool } from '../src/modules/knowledge/knowledge-search-tools/simple-text-knowledge-search.tool';

const textResult: KnowledgeSearchResult = {
  id: 'knowledge-1',
  question: 'When is the clinic open?',
  answer: 'The clinic opens at 9 AM.',
  category: 'clinic_information',
  sourceFile: null,
  sourcePage: null,
  score: 0.8,
  searchProvider: 'text',
};

function createTool(options: { fallback: boolean; vectorRejects?: boolean }) {
  const textSearch = {
    search: vi.fn().mockResolvedValue([textResult]),
  } as unknown as SimpleTextKnowledgeSearchTool;
  const vectorSearch = {
    search: options.vectorRejects
      ? vi.fn().mockRejectedValue(new Error('embedding service unavailable'))
      : vi.fn().mockResolvedValue([]),
  } as unknown as PgVectorKnowledgeSearchTool;
  const env = {
    KNOWLEDGE_VECTOR_MAX_RESULTS: 5,
    KNOWLEDGE_VECTOR_USE_HYBRID_FALLBACK: options.fallback,
  } as ApiEnv;

  return new HybridKnowledgeSearchTool(textSearch, vectorSearch, env);
}

describe('HybridKnowledgeSearchTool', () => {
  it('returns text matches when vector search fails and fallback is enabled', async () => {
    const tool = createTool({ fallback: true, vectorRejects: true });

    await expect(tool.search({ clinicId: 'clinic-1', query: 'opening hours' })).resolves.toEqual([
      { ...textResult, searchProvider: 'hybrid' },
    ]);
  });

  it('surfaces vector failures when fallback is disabled', async () => {
    const tool = createTool({ fallback: false, vectorRejects: true });

    await expect(tool.search({ clinicId: 'clinic-1', query: 'opening hours' })).rejects.toThrow(
      'embedding service unavailable',
    );
  });
});
