import { Inject, Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import type { KnowledgeSearchResult } from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';

import { KnowledgeSearchFactory } from './knowledge-search.factory';

export type KnowledgeApprovedSearchResult = KnowledgeSearchResult & {
  meetsThreshold: boolean;
};

@Injectable()
export class KnowledgeSearchService {
  constructor(
    @Inject(KnowledgeSearchFactory) private readonly searchFactory: KnowledgeSearchFactory,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  getActiveProvider(): 'text' | 'pgvector' | 'hybrid' {
    return this.searchFactory.getActiveProvider();
  }

  async searchApprovedKnowledge(
    clinicId: string,
    queryText: string,
    categoryHint?: string | null,
  ): Promise<KnowledgeApprovedSearchResult | null> {
    const normalized = queryText.trim();
    if (!normalized) {
      return null;
    }

    const searchTool = this.searchFactory.create();
    const results = await searchTool.search({
      clinicId,
      query: normalized,
      categoryHint: categoryHint ?? null,
      limit: this.env.KNOWLEDGE_VECTOR_MAX_RESULTS,
    });

    if (!results.length) {
      return null;
    }

    const best = results[0]!;
    return {
      ...best,
      meetsThreshold: best.score >= this.env.KNOWLEDGE_VECTOR_MIN_SCORE,
    };
  }
}
