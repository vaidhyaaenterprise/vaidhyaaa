import { Inject, Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import type { KnowledgeSearchInput, KnowledgeSearchResult } from '@vaidya/shared';

import { API_ENV } from '../../../config/api-config.module';

import { PgVectorKnowledgeSearchTool } from './pgvector-knowledge-search.tool';
import { SimpleTextKnowledgeSearchTool } from './simple-text-knowledge-search.tool';

@Injectable()
export class HybridKnowledgeSearchTool {
  constructor(
    @Inject(SimpleTextKnowledgeSearchTool)
    private readonly textSearch: SimpleTextKnowledgeSearchTool,
    @Inject(PgVectorKnowledgeSearchTool)
    private readonly vectorSearch: PgVectorKnowledgeSearchTool,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]> {
    const limit = input.limit ?? this.env.KNOWLEDGE_VECTOR_MAX_RESULTS;
    const [vectorResults, textResults] = await Promise.all([
      this.vectorSearch.search({ ...input, limit }),
      this.textSearch.search({ ...input, limit }),
    ]);

    const merged = new Map<string, KnowledgeSearchResult>();

    for (const result of [...vectorResults, ...textResults]) {
      const existing = merged.get(result.id);
      if (!existing || result.score > existing.score) {
        merged.set(result.id, {
          ...result,
          searchProvider: 'hybrid',
        });
      }
    }

    return [...merged.values()].sort((left, right) => right.score - left.score).slice(0, limit);
  }
}
