import { Inject, Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import { createRepositories, type Repositories } from '@vaidya/db';
import type { DatabaseConnection } from '@vaidya/db';
import type { KnowledgeSearchInput, KnowledgeSearchResult } from '@vaidya/shared';

import { API_ENV } from '../../../config/api-config.module';
import { DATABASE_CONNECTION } from '../../database/database.module';
import { createEmbeddingProvider } from '../embedding-provider.factory';

@Injectable()
export class PgVectorKnowledgeSearchTool {
  private readonly repos: Repositories;
  private readonly embeddingProvider;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.repos = createRepositories(connection.db);
    this.embeddingProvider = createEmbeddingProvider(env);
  }

  async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]> {
    const normalized = input.query.trim();
    if (!normalized) {
      return [];
    }

    const queryEmbedding = await this.embeddingProvider.embed({
      text: normalized,
      clinicId: input.clinicId,
    });

    const rows = await this.repos.knowledge.searchApprovedByVector(
      input.clinicId,
      queryEmbedding.vector,
      input.limit ?? 5,
    );

    return rows.map((row) => {
      let score = row.score;
      if (input.categoryHint && row.category === input.categoryHint) {
        score = Math.min(1, score + 0.05);
      }
      return {
        id: row.id,
        question: row.question,
        answer: row.answer,
        category: row.category,
        sourceFile: row.sourceFile,
        sourcePage: row.sourcePage,
        score,
        searchProvider: 'pgvector' as const,
        embeddingModel: row.embeddingModel,
      };
    });
  }
}
