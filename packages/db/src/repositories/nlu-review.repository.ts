import { and, desc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../client';
import { nluReviewItems } from '../schema';

export type NluReviewItemRow = typeof nluReviewItems.$inferSelect;

export type CreateNluReviewItemInput = {
  clinicId: string;
  sessionId: string;
  messageId: string;
  messageTextRedacted: string;
  currentFlow: string;
  currentState: string;
  failureType: 'classifier' | 'router' | 'interpreter';
  captureReason:
    | 'unknown_intent'
    | 'low_confidence'
    | 'unrecognized_active_state'
    | 'low_confidence_state_extraction';
  predictedIntent?: string | null;
  predictedConfidence?: number | null;
  predictedEntitiesJson?: Record<string, unknown>;
};

export type ReviewNluReviewItemInput = {
  clinicId: string;
  reviewItemId: string;
  correctIntent: string;
  correctEntitiesJson?: Record<string, unknown>;
  reviewedByUserId: string;
};

export class NluReviewRepository {
  constructor(private readonly db: Database) {}

  upsertReviewItem(input: CreateNluReviewItemInput) {
    const confidence =
      input.predictedConfidence === null || input.predictedConfidence === undefined
        ? null
        : String(input.predictedConfidence);

    return this.db
      .insert(nluReviewItems)
      .values({
        clinicId: input.clinicId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        messageTextRedacted: input.messageTextRedacted,
        currentFlow: input.currentFlow,
        currentState: input.currentState,
        failureType: input.failureType,
        captureReason: input.captureReason,
        predictedIntent: input.predictedIntent ?? null,
        predictedConfidence: confidence,
        predictedEntitiesJson: input.predictedEntitiesJson ?? {},
      })
      .onConflictDoUpdate({
        target: [nluReviewItems.clinicId, nluReviewItems.messageId],
        set: {
          messageTextRedacted: input.messageTextRedacted,
          currentFlow: input.currentFlow,
          currentState: input.currentState,
          failureType: input.failureType,
          captureReason: input.captureReason,
          predictedIntent: input.predictedIntent ?? null,
          predictedConfidence: confidence,
          predictedEntitiesJson: input.predictedEntitiesJson ?? {},
        },
      })
      .returning();
  }

  findReviewItem(clinicId: string, reviewItemId: string) {
    return this.db
      .select()
      .from(nluReviewItems)
      .where(and(eq(nluReviewItems.clinicId, clinicId), eq(nluReviewItems.id, reviewItemId)))
      .limit(1);
  }

  listReviewItems(clinicId: string, reviewStatus?: string) {
    const filters = [eq(nluReviewItems.clinicId, clinicId)];
    if (reviewStatus) {
      filters.push(eq(nluReviewItems.reviewStatus, reviewStatus));
    }
    return this.db
      .select()
      .from(nluReviewItems)
      .where(and(...filters))
      .orderBy(desc(nluReviewItems.createdAt));
  }

  markReviewed(input: ReviewNluReviewItemInput) {
    return this.db
      .update(nluReviewItems)
      .set({
        correctIntent: input.correctIntent,
        correctEntitiesJson: input.correctEntitiesJson ?? {},
        reviewStatus: 'reviewed',
        reviewedByUserId: input.reviewedByUserId,
        reviewedAt: new Date(),
      })
      .where(and(eq(nluReviewItems.clinicId, input.clinicId), eq(nluReviewItems.id, input.reviewItemId)))
      .returning();
  }

  listReviewedForExport(clinicId: string) {
    return this.db
      .select()
      .from(nluReviewItems)
      .where(
        and(eq(nluReviewItems.clinicId, clinicId), inArray(nluReviewItems.reviewStatus, ['reviewed', 'exported'])),
      )
      .orderBy(desc(nluReviewItems.reviewedAt));
  }

  markExported(clinicId: string, reviewItemIds: string[]) {
    if (reviewItemIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.db
      .update(nluReviewItems)
      .set({ reviewStatus: 'exported' })
      .where(
        and(eq(nluReviewItems.clinicId, clinicId), inArray(nluReviewItems.id, reviewItemIds)),
      )
      .returning({ id: nluReviewItems.id });
  }
}
