import { createHash } from 'node:crypto';

import { and, desc, eq, inArray, sql as drizzleSql } from 'drizzle-orm';

import type { Database } from '../client';
import { clinicKnowledgeBase } from '../schema';

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

export type KnowledgeEmbeddingStatusSummary = {
  approvedTotal: number;
  generatedCount: number;
  pendingCount: number;
  failedCount: number;
  staleCount: number;
  notRequiredCount: number;
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

  async findPotentialDuplicates(clinicId: string, normalizedSignature: string, limit = 5) {
    const rows = await this.db
      .select({
        id: clinicKnowledgeBase.id,
        question: clinicKnowledgeBase.question,
        category: clinicKnowledgeBase.category,
        status: clinicKnowledgeBase.status,
      })
      .from(clinicKnowledgeBase)
      .where(eq(clinicKnowledgeBase.clinicId, clinicId));

    return rows
      .filter((row) => normalizeQuestionSignature(row.question) === normalizedSignature)
      .slice(0, limit);
  }

  findKnowledgeEntry(clinicId: string, knowledgeId: string) {
    return this.db
      .select()
      .from(clinicKnowledgeBase)
      .where(and(eq(clinicKnowledgeBase.clinicId, clinicId), eq(clinicKnowledgeBase.id, knowledgeId)))
      .limit(1);
  }

  listApprovedKnowledge(clinicId: string) {
    return this.db
      .select()
      .from(clinicKnowledgeBase)
      .where(
        and(eq(clinicKnowledgeBase.clinicId, clinicId), eq(clinicKnowledgeBase.status, 'approved')),
      );
  }

  listKnowledgeEntries(clinicId: string) {
    return this.db
      .select()
      .from(clinicKnowledgeBase)
      .where(eq(clinicKnowledgeBase.clinicId, clinicId))
      .orderBy(desc(clinicKnowledgeBase.updatedAt));
  }

  listKnowledgeForEmbeddingRegenerate(clinicId: string, onlyStatus: 'approved' | 'all' = 'approved') {
    const statusFilter =
      onlyStatus === 'approved'
        ? eq(clinicKnowledgeBase.status, 'approved')
        : inArray(clinicKnowledgeBase.status, ['approved', 'pending_review', 'disabled', 'needs_update']);

    return this.db
      .select({
        id: clinicKnowledgeBase.id,
        status: clinicKnowledgeBase.status,
      })
      .from(clinicKnowledgeBase)
      .where(and(eq(clinicKnowledgeBase.clinicId, clinicId), statusFilter));
  }

  updateKnowledgeEntry(
    clinicId: string,
    knowledgeId: string,
    values: Partial<typeof clinicKnowledgeBase.$inferInsert>,
  ) {
    return this.db
      .update(clinicKnowledgeBase)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(clinicKnowledgeBase.clinicId, clinicId), eq(clinicKnowledgeBase.id, knowledgeId)))
      .returning();
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
