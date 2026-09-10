import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import type { DatabaseConnection } from '@vaidya/db';
import type { KnowledgeSearchInput, KnowledgeSearchResult } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../../database/database.module';

const TEXT_SCORE_NORMALIZER = 15;

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizePunctuation(text: string): string {
  return text.replace(/[-–—/\\?.,!]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordBoundaryIncludes(text: string, token: string): boolean {
  const rx = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return rx.test(text);
}

function scoreApprovedTextRow(
  row: {
    question: string;
    searchText: string | null;
    alternativePhrasesJson: unknown;
  },
  normalizedQuery: string,
): number {
  const queryPc = normalizePunctuation(normalizedQuery);
  const haystacks = [
    row.question,
    row.searchText ?? '',
    ...((row.alternativePhrasesJson as string[] | null) ?? []),
  ].map((value) => normalizePunctuation(value.toLowerCase()));

  let rawScore = 0;

  // full normalized match — query text found verbatim in any haystack
  if (haystacks.some((h) => h.length > 0 && h.includes(queryPc))) {
    rawScore = Math.max(rawScore, queryPc.length + 15);
  }

  // token overlap (word-boundary-aware with prefix fallback)
  const queryTokens = queryPc.split(/\s+/).filter((t) => t.length > 2);
  const allHaystackText = haystacks.join(' ');
  const allHaystackTokens = haystacks
    .flatMap((h) => h.split(/\s+/))
    .filter((t) => t.length > 0);
  const matchedTokens = queryTokens.filter((t) => {
    if (wordBoundaryIncludes(allHaystackText, t)) return true;
    return allHaystackTokens.some((ht) => ht.startsWith(t) || t.startsWith(ht));
  }).length;
  rawScore = Math.max(rawScore, matchedTokens * 7);

  // partial bigram overlap
  if (queryTokens.length >= 2) {
    for (let i = 0; i < queryTokens.length - 1; i++) {
      const bigram = queryTokens[i] + ' ' + queryTokens[i + 1];
      if (wordBoundaryIncludes(allHaystackText, bigram)) {
        rawScore += 6;
      }
    }
  }

  return Math.min(1, rawScore / TEXT_SCORE_NORMALIZER);
}

@Injectable()
export class SimpleTextKnowledgeSearchTool {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]> {
    const normalized = normalizeText(input.query);
    if (!normalized) {
      return [];
    }

    const rows = await this.repos.knowledge.listApprovedKnowledge(input.clinicId);
    const limit = input.limit ?? 5;
    const scored = rows
      .map((row) => {
        let score = scoreApprovedTextRow(row, normalized);
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
          searchProvider: 'text' as const,
          embeddingModel: row.embeddingModel,
        };
      })
      .filter((row) => row.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return scored;
  }
}
