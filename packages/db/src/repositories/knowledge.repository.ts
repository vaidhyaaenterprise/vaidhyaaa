import { createHash } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull, or, sql as drizzleSql } from 'drizzle-orm';

import type { Database } from '../client';
import { clinicKnowledgeBase, clinicKnowledgeSections } from '../schema';

export type KnowledgeEntryRow = typeof clinicKnowledgeBase.$inferSelect;

export type KnowledgeVectorSearchRow = {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  sourceFile: string | null;
  sourcePage: number | null;
  embeddingModel: string | null;
  score: number;
};

export type ManualTemplateEntryRow = KnowledgeEntryRow;
export type KnowledgeSectionRow = typeof clinicKnowledgeSections.$inferSelect;

export type KnowledgeEmbeddingStatusSummary = {
  approvedTotal: number;
  generatedCount: number;
  pendingCount: number;
  failedCount: number;
  staleCount: number;
  notRequiredCount: number;
};

export type KnowledgeApprovalCandidate = {
  id: string;
  answer: string;
};

export class KnowledgeRepository {
  constructor(private readonly db: Database) {}

  createKnowledgeEntry(values: typeof clinicKnowledgeBase.$inferInsert) {
    return this.db.insert(clinicKnowledgeBase).values(values).returning();
  }

  findByTemplateKey(clinicId: string, templateKey: string) {
    return this.db
      .select()
      .from(clinicKnowledgeBase)
      .where(
        and(
          eq(clinicKnowledgeBase.clinicId, clinicId),
          eq(clinicKnowledgeBase.templateKey, templateKey),
        ),
      )
      .limit(1);
  }

  listManualTemplateEntries(clinicId: string): Promise<ManualTemplateEntryRow[]> {
    return this.db
      .select()
      .from(clinicKnowledgeBase)
      .where(eq(clinicKnowledgeBase.clinicId, clinicId))
      .orderBy(desc(clinicKnowledgeBase.updatedAt));
  }

  listKnowledgeSections(clinicId: string): Promise<KnowledgeSectionRow[]> {
    return this.db
      .select()
      .from(clinicKnowledgeSections)
      .where(eq(clinicKnowledgeSections.clinicId, clinicId))
      .orderBy(asc(clinicKnowledgeSections.sortOrder), asc(clinicKnowledgeSections.createdAt));
  }

  upsertKnowledgeSection(values: typeof clinicKnowledgeSections.$inferInsert) {
    return this.db
      .insert(clinicKnowledgeSections)
      .values(values)
      .onConflictDoUpdate({
        target: [clinicKnowledgeSections.clinicId, clinicKnowledgeSections.sectionKey],
        set: {
          title: values.title,
          isCustom: values.isCustom,
          active: values.active,
          sortOrder: values.sortOrder,
          updatedAt: new Date(),
        },
      })
      .returning();
  }

  archiveKnowledgeSection(values: typeof clinicKnowledgeSections.$inferInsert) {
    return this.db.transaction(async (transaction) => {
      const approvedEntry = await transaction
        .select({ id: clinicKnowledgeBase.id })
        .from(clinicKnowledgeBase)
        .where(
          and(
            eq(clinicKnowledgeBase.clinicId, values.clinicId),
            eq(clinicKnowledgeBase.sectionKey, values.sectionKey),
            isNull(clinicKnowledgeBase.removedAt),
            or(
              eq(clinicKnowledgeBase.status, 'approved'),
              eq(clinicKnowledgeBase.qaApproved, true),
            ),
          ),
        )
        .limit(1);

      if (approvedEntry.length > 0) {
        return { blocked: true, section: null };
      }

      const removedAt = new Date();
      await transaction
        .update(clinicKnowledgeBase)
        .set({ removedAt, updatedAt: removedAt })
        .where(
          and(
            eq(clinicKnowledgeBase.clinicId, values.clinicId),
            eq(clinicKnowledgeBase.sectionKey, values.sectionKey),
            isNull(clinicKnowledgeBase.removedAt),
          ),
        );

      const [section] = await transaction
        .insert(clinicKnowledgeSections)
        .values(values)
        .onConflictDoUpdate({
          target: [clinicKnowledgeSections.clinicId, clinicKnowledgeSections.sectionKey],
          set: {
            title: values.title,
            isCustom: values.isCustom,
            active: false,
            sortOrder: values.sortOrder,
            updatedAt: removedAt,
          },
        })
        .returning();

      return { blocked: false, section: section ?? null };
    });
  }

  listVisibleSectionEntries(clinicId: string, sectionKey: string) {
    return this.db
      .select()
      .from(clinicKnowledgeBase)
      .where(
        and(
          eq(clinicKnowledgeBase.clinicId, clinicId),
          eq(clinicKnowledgeBase.sectionKey, sectionKey),
          isNull(clinicKnowledgeBase.removedAt),
        ),
      );
  }

  removeKnowledgeEntry(clinicId: string, knowledgeId: string) {
    return this.db
      .update(clinicKnowledgeBase)
      .set({ removedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(clinicKnowledgeBase.clinicId, clinicId),
          eq(clinicKnowledgeBase.id, knowledgeId),
          isNull(clinicKnowledgeBase.removedAt),
        ),
      )
      .returning();
  }

  async findPotentialDuplicates(clinicId: string, normalizedSignature: string, limit = 5) {
    const rows = await this.db
      .select({
        id: clinicKnowledgeBase.id,
        question: clinicKnowledgeBase.question,
        category: clinicKnowledgeBase.category,
        status: clinicKnowledgeBase.status,
      })
      .from(clinicKnowledgeBase)
      .where(
        and(eq(clinicKnowledgeBase.clinicId, clinicId), isNull(clinicKnowledgeBase.removedAt)),
      );

    return rows
      .filter((row) => normalizeQuestionSignature(row.question) === normalizedSignature)
      .slice(0, limit);
  }

  findKnowledgeEntry(clinicId: string, knowledgeId: string) {
    return this.db
      .select()
      .from(clinicKnowledgeBase)
      .where(
        and(
          eq(clinicKnowledgeBase.clinicId, clinicId),
          eq(clinicKnowledgeBase.id, knowledgeId),
          isNull(clinicKnowledgeBase.removedAt),
        ),
      )
      .limit(1);
  }

  listApprovedKnowledge(clinicId: string) {
    return this.db
      .select()
      .from(clinicKnowledgeBase)
      .where(
        and(
          eq(clinicKnowledgeBase.clinicId, clinicId),
          eq(clinicKnowledgeBase.status, 'approved'),
          isNull(clinicKnowledgeBase.removedAt),
        ),
      );
  }

  listKnowledgeEntries(clinicId: string) {
    return this.db
      .select()
      .from(clinicKnowledgeBase)
      .where(and(eq(clinicKnowledgeBase.clinicId, clinicId), isNull(clinicKnowledgeBase.removedAt)))
      .orderBy(desc(clinicKnowledgeBase.updatedAt));
  }

  findKnowledgeEntriesByIds(clinicId: string, knowledgeIds: string[]) {
    return this.db
      .select()
      .from(clinicKnowledgeBase)
      .where(
        and(
          eq(clinicKnowledgeBase.clinicId, clinicId),
          inArray(clinicKnowledgeBase.id, knowledgeIds),
          isNull(clinicKnowledgeBase.removedAt),
        ),
      );
  }

  listKnowledgeForEmbeddingRegenerate(
    clinicId: string,
    onlyStatus: 'approved' | 'all' = 'approved',
  ) {
    const statusFilter =
      onlyStatus === 'approved'
        ? eq(clinicKnowledgeBase.status, 'approved')
        : inArray(clinicKnowledgeBase.status, [
            'approved',
            'pending_review',
            'disabled',
            'needs_update',
          ]);

    return this.db
      .select({
        id: clinicKnowledgeBase.id,
        status: clinicKnowledgeBase.status,
      })
      .from(clinicKnowledgeBase)
      .where(
        and(
          eq(clinicKnowledgeBase.clinicId, clinicId),
          statusFilter,
          isNull(clinicKnowledgeBase.removedAt),
        ),
      );
  }

  updateKnowledgeEntry(
    clinicId: string,
    knowledgeId: string,
    values: Partial<typeof clinicKnowledgeBase.$inferInsert>,
  ) {
    return this.db
      .update(clinicKnowledgeBase)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(clinicKnowledgeBase.clinicId, clinicId),
          eq(clinicKnowledgeBase.id, knowledgeId),
          isNull(clinicKnowledgeBase.removedAt),
        ),
      )
      .returning();
  }

  bulkApproveKnowledgeEntries(
    clinicId: string,
    candidates: KnowledgeApprovalCandidate[],
    approvedByUserId?: string,
  ) {
    const approvedAt = new Date();
    const validatedCandidateFilter =
      or(
        ...candidates.map((candidate) =>
          and(
            eq(clinicKnowledgeBase.id, candidate.id),
            eq(clinicKnowledgeBase.answer, candidate.answer),
          ),
        ),
      ) ?? drizzleSql`false`;

    return this.db
      .update(clinicKnowledgeBase)
      .set({
        status: 'approved',
        qaApproved: true,
        embeddingStatus: 'pending',
        embeddingError: null,
        approvedAt,
        ...(approvedByUserId ? { approvedByUserId } : {}),
        updatedAt: approvedAt,
      })
      .where(
        and(
          eq(clinicKnowledgeBase.clinicId, clinicId),
          validatedCandidateFilter,
          inArray(clinicKnowledgeBase.status, ['pending_review', 'needs_update']),
          eq(clinicKnowledgeBase.applicable, true),
          isNull(clinicKnowledgeBase.removedAt),
          drizzleSql`btrim(${clinicKnowledgeBase.answer}) <> ''`,
        ),
      )
      .returning({ id: clinicKnowledgeBase.id });
  }

  bulkMarkEmbeddingFailed(clinicId: string, knowledgeIds: string[], errorMessage: string) {
    return this.db
      .update(clinicKnowledgeBase)
      .set({
        embeddingStatus: 'failed',
        embeddingError: errorMessage,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clinicKnowledgeBase.clinicId, clinicId),
          inArray(clinicKnowledgeBase.id, knowledgeIds),
          eq(clinicKnowledgeBase.embeddingStatus, 'pending'),
          isNull(clinicKnowledgeBase.removedAt),
        ),
      )
      .returning({ id: clinicKnowledgeBase.id });
  }

  async searchApprovedByVector(
    clinicId: string,
    queryVector: number[],
    limit: number,
  ): Promise<KnowledgeVectorSearchRow[]> {
    const vectorLiteral = `[${queryVector.join(',')}]`;
    const rows = await this.db.execute<{
      id: string;
      question: string;
      answer: string;
      category: string | null;
      source_file: string | null;
      source_page: number | null;
      embedding_model: string | null;
      score: number;
    }>(drizzleSql`
      SELECT
        id,
        question,
        answer,
        category,
        source_file,
        source_page,
        embedding_model,
        1 - (embedding <=> ${vectorLiteral}::vector) AS score
      FROM clinic_knowledge_base
      WHERE clinic_id = ${clinicId}::uuid
        AND status = 'approved'
        AND qa_approved = true
        AND applicable = true
        AND embedding_status = 'generated'
        AND removed_at IS NULL
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      category: row.category,
      sourceFile: row.source_file,
      sourcePage: row.source_page,
      embeddingModel: row.embedding_model,
      score: Number(row.score),
    }));
  }

  async updateEmbedding(input: {
    clinicId: string;
    knowledgeId: string;
    vector: number[];
    questionVector: number[];
    answerVector: number[];
    model: string;
    dimensions: number;
    sourceHash: string;
    jobId?: string | null;
  }) {
    const vectorLiteral = `[${input.vector.join(',')}]`;
    const questionVectorLiteral = `[${input.questionVector.join(',')}]`;
    const answerVectorLiteral = `[${input.answerVector.join(',')}]`;
    await this.db.execute(drizzleSql`
      UPDATE clinic_knowledge_base
      SET
        embedding = ${vectorLiteral}::vector,
        question_embedding = ${questionVectorLiteral}::vector,
        answer_embedding = ${answerVectorLiteral}::vector,
        embedding_model = ${input.model},
        embedding_dimensions = ${input.dimensions},
        embedding_status = 'generated',
        embedding_generated_at = now(),
        embedding_error = NULL,
        embedding_source_hash = ${input.sourceHash},
        last_embedding_job_id = ${input.jobId ?? null}::uuid,
        updated_at = now()
      WHERE clinic_id = ${input.clinicId}::uuid
        AND id = ${input.knowledgeId}::uuid
        AND removed_at IS NULL
    `);
  }

  async markEmbeddingFailed(clinicId: string, knowledgeId: string, errorMessage: string) {
    await this.db.execute(drizzleSql`
      UPDATE clinic_knowledge_base
      SET
        embedding_status = 'failed',
        embedding_error = ${errorMessage},
        updated_at = now()
      WHERE clinic_id = ${clinicId}::uuid
        AND id = ${knowledgeId}::uuid
        AND removed_at IS NULL
    `);
  }

  async markEmbeddingNotRequired(clinicId: string, knowledgeId: string) {
    await this.db.execute(drizzleSql`
      UPDATE clinic_knowledge_base
      SET
        embedding_status = 'not_required',
        updated_at = now()
      WHERE clinic_id = ${clinicId}::uuid
        AND id = ${knowledgeId}::uuid
        AND removed_at IS NULL
    `);
  }

  async getEmbeddingStatusSummary(clinicId: string): Promise<KnowledgeEmbeddingStatusSummary> {
    const [row] = await this.db.execute<{
      approved_total: number;
      generated_count: number;
      pending_count: number;
      failed_count: number;
      stale_count: number;
      not_required_count: number;
    }>(drizzleSql`
      SELECT
        count(*) FILTER (WHERE status = 'approved')::int AS approved_total,
        count(*) FILTER (WHERE status = 'approved' AND embedding_status = 'generated')::int AS generated_count,
        count(*) FILTER (WHERE status = 'approved' AND embedding_status = 'pending')::int AS pending_count,
        count(*) FILTER (WHERE status = 'approved' AND embedding_status = 'failed')::int AS failed_count,
        count(*) FILTER (WHERE status = 'approved' AND embedding_status = 'stale')::int AS stale_count,
        count(*) FILTER (WHERE embedding_status = 'not_required')::int AS not_required_count
      FROM clinic_knowledge_base
      WHERE clinic_id = ${clinicId}::uuid
        AND removed_at IS NULL
    `);

    return {
      approvedTotal: Number(row?.approved_total ?? 0),
      generatedCount: Number(row?.generated_count ?? 0),
      pendingCount: Number(row?.pending_count ?? 0),
      failedCount: Number(row?.failed_count ?? 0),
      staleCount: Number(row?.stale_count ?? 0),
      notRequiredCount: Number(row?.not_required_count ?? 0),
    };
  }
}

export function normalizeQuestionSignature(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeEmbeddingSourceHash(searchText: string, model: string): string {
  return createHash('sha256').update(`${searchText}|${model}`).digest('hex');
}
