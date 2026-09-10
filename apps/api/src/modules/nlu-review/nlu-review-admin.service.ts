import { Inject, Injectable } from '@nestjs/common';

import {
  createRepositories,
  DatabaseService,
  type DatabaseConnection,
  type Repositories,
} from '@vaidya/db';
import {
  AppError,
  buildNluReviewExportCases,
  type NluReviewExportCase,
  type PatchNluReviewItemInput,
} from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';

@Injectable()
export class NluReviewAdminService {
  private readonly db: DatabaseService;
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.db = new DatabaseService(connection.db);
    this.repos = createRepositories(connection.db);
  }

  async listReviewItems(clinicId: string, reviewStatus?: string) {
    const rows = await this.repos.nluReview.listReviewItems(clinicId, reviewStatus);
    return rows.map((row) => this.toResponse(row));
  }

  async getReviewItem(clinicId: string, reviewItemId: string) {
    const [row] = await this.repos.nluReview.findReviewItem(clinicId, reviewItemId);
    if (!row) {
      throw new AppError('NOT_FOUND', 'NLU review item not found.');
    }
    return this.toResponse(row);
  }

  async markReviewed(
    clinicId: string,
    reviewItemId: string,
    input: PatchNluReviewItemInput,
    reviewedByUserId: string,
  ) {
    const [existing] = await this.repos.nluReview.findReviewItem(clinicId, reviewItemId);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'NLU review item not found.');
    }

    const [updated] = await this.repos.nluReview.markReviewed({
      clinicId,
      reviewItemId,
      correctIntent: input.correct_intent,
      correctEntitiesJson: input.correct_entities_json ?? {},
      reviewedByUserId,
    });
    if (!updated) {
      throw new AppError('NOT_FOUND', 'NLU review item not found.');
    }

    await this.db.insertAuditLog({
      clinicId,
      actorType: 'clinic_admin',
      actorUserId: reviewedByUserId,
      eventType: 'nlu_review_item.reviewed',
      entityType: 'nlu_review_item',
      entityId: reviewItemId,
      source: 'nlu_review_admin',
      eventData: {
        correct_intent: input.correct_intent,
        correct_entities_json: input.correct_entities_json ?? {},
      },
    });

    return this.toResponse(updated);
  }

  async exportReviewedItems(clinicId: string): Promise<{ cases: NluReviewExportCase[] }> {
    const rows = await this.repos.nluReview.listReviewedForExport(clinicId);
    const cases = buildNluReviewExportCases(rows);
    const exportedIds = rows
      .filter((row) => row.reviewStatus === 'reviewed')
      .map((row) => row.id);
    if (exportedIds.length > 0) {
      await this.repos.nluReview.markExported(clinicId, exportedIds);
    }
    return { cases };
  }

  private toResponse(row: {
    id: string;
    clinicId: string;
    sessionId: string;
    messageId: string;
    messageTextRedacted: string;
    currentFlow: string;
    currentState: string;
    failureType: string;
    captureReason: string;
    predictedIntent: string | null;
    predictedConfidence: string | null;
    predictedEntitiesJson: unknown;
    correctIntent: string | null;
    correctEntitiesJson: unknown;
    reviewStatus: string;
    reviewedByUserId: string | null;
    createdAt: Date;
    reviewedAt: Date | null;
  }) {
    return {
      id: row.id,
      clinic_id: row.clinicId,
      session_id: row.sessionId,
      message_id: row.messageId,
      message_text_redacted: row.messageTextRedacted,
      current_flow: row.currentFlow,
      current_state: row.currentState,
      failure_type: row.failureType,
      capture_reason: row.captureReason,
      predicted_intent: row.predictedIntent,
      predicted_confidence:
        row.predictedConfidence === null ? null : Number(row.predictedConfidence),
      predicted_entities_json:
        row.predictedEntitiesJson && typeof row.predictedEntitiesJson === 'object'
          ? row.predictedEntitiesJson
          : {},
      correct_intent: row.correctIntent,
      correct_entities_json:
        row.correctEntitiesJson && typeof row.correctEntitiesJson === 'object'
          ? row.correctEntitiesJson
          : null,
      review_status: row.reviewStatus,
      reviewed_by_user_id: row.reviewedByUserId,
      created_at: row.createdAt.toISOString(),
      reviewed_at: row.reviewedAt?.toISOString() ?? null,
    };
  }
}
