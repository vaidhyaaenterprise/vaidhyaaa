import { Inject, Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import type { KnowledgeSearchTool } from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';

import { HybridKnowledgeSearchTool } from './knowledge-search-tools/hybrid-knowledge-search.tool';
import { PgVectorKnowledgeSearchTool } from './knowledge-search-tools/pgvector-knowledge-search.tool';
import { SimpleTextKnowledgeSearchTool } from './knowledge-search-tools/simple-text-knowledge-search.tool';

@Injectable()
export class KnowledgeSearchFactory {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(SimpleTextKnowledgeSearchTool)
    private readonly textSearch: SimpleTextKnowledgeSearchTool,
    @Inject(PgVectorKnowledgeSearchTool)
    private readonly vectorSearch: PgVectorKnowledgeSearchTool,
    @Inject(HybridKnowledgeSearchTool)
    private readonly hybridSearch: HybridKnowledgeSearchTool,
  ) {}

  create(): KnowledgeSearchTool {
    switch (this.env.KNOWLEDGE_SEARCH_PROVIDER) {
      case 'text':
        return this.textSearch;
      case 'pgvector':
        return this.vectorSearch;
      case 'hybrid':
        return this.hybridSearch;
      default:
        return this.textSearch;
    }
  }

  getActiveProvider(): 'text' | 'pgvector' | 'hybrid' {
    return this.env.KNOWLEDGE_SEARCH_PROVIDER;
  }
}
