import { desc, eq } from 'drizzle-orm';

import { reviewedExamples } from '../schema';

import type { Database } from '../client';

export type ReviewedExampleRow = typeof reviewedExamples.$inferSelect;

export type CreateReviewedExampleInput = {
  languageCode: string;
  messageTextRedacted: string;
  contextFlow: string;
  contextState: string;
  expectedRecognizedAs: string;
  expectedIntent?: string | null;
  expectedEntitiesJson?: Record<string, unknown>;
  source?: string;
  approvedForPromptExamples?: boolean;
};

export class ReviewedExamplesRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateReviewedExampleInput) {
    return this.db
      .insert(reviewedExamples)
      .values({
        languageCode: input.languageCode,
        messageTextRedacted: input.messageTextRedacted,
        contextFlow: input.contextFlow,
        contextState: input.contextState,
        expectedRecognizedAs: input.expectedRecognizedAs,
        expectedIntent: input.expectedIntent ?? null,
        expectedEntitiesJson: input.expectedEntitiesJson ?? {},
        source: input.source ?? 'manual_review',
        approvedForPromptExamples: input.approvedForPromptExamples ?? false,
      })
      .returning();
  }

  findById(id: string) {
    return this.db
      .select()
      .from(reviewedExamples)
      .where(eq(reviewedExamples.id, id))
      .limit(1);
  }

  listAll() {
    return this.db.select().from(reviewedExamples).orderBy(desc(reviewedExamples.createdAt));
  }

  listForPromptExport() {
    return this.db
      .select()
      .from(reviewedExamples)
      .where(eq(reviewedExamples.approvedForPromptExamples, true))
      .orderBy(desc(reviewedExamples.createdAt));
  }

  listForLanguagePackProposal() {
    return this.db.select().from(reviewedExamples).orderBy(desc(reviewedExamples.createdAt));
  }
}
