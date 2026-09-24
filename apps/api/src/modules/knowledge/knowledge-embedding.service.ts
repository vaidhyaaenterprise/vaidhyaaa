import { Inject, Injectable, Logger } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import {
  computeEmbeddingSourceHash,
  createRepositories,
  DatabaseService,
  type Repositories,
} from '@vaidya/db';
import type { DatabaseConnection } from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  buildKnowledgeSearchText,
  JOB_QUEUE_MAP,
  JOB_TYPES,
  type QueueService,
} from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';
import { DATABASE_CONNECTION } from '../database/database.module';

import { createEmbeddingProvider } from './embedding-provider.factory';

export type EmbeddingJobReason = 'approved' | 'edited' | 'bulk_regenerate' | 'manual_retry';

export type BulkEmbeddingEnqueueResult = {
  queuedKnowledgeIds: string[];
  failedKnowledgeIds: string[];
};

@Injectable()
export class KnowledgeEmbeddingService {
  private readonly logger = new Logger(KnowledgeEmbeddingService.name);
  private readonly repos: Repositories;
  private readonly embeddingProvider;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(DatabaseService) private readonly dbService: DatabaseService,
    @Inject(ADAPTER_TOKENS.QueueService) private readonly queueService: QueueService,
  ) {
    this.repos = createRepositories(connection.db);
    this.embeddingProvider = createEmbeddingProvider(env);
  }

  async enqueueEmbeddingJob(input: {
    clinicId: string;
    knowledgeEntryId: string;
    requestedByUserId?: string;
    reason?: EmbeddingJobReason;
  }) {
    await this.queueService.enqueue({
      queue: JOB_QUEUE_MAP[JOB_TYPES.GENERATE_KNOWLEDGE_EMBEDDING],
      jobType: JOB_TYPES.GENERATE_KNOWLEDGE_EMBEDDING,
      clinicId: input.clinicId,
      payload: {
        clinic_id: input.clinicId,
        knowledge_entry_id: input.knowledgeEntryId,
        ...(input.requestedByUserId ? { requested_by_user_id: input.requestedByUserId } : {}),
        reason: input.reason ?? 'approved',
      },
    });

    await this.dbService.insertAuditLog({
      clinicId: input.clinicId,
      actorType: 'system',
      eventType: 'knowledge_embedding_job_queued',
      entityType: 'clinic_knowledge_base',
      entityId: input.knowledgeEntryId,
      eventData: {
        reason: input.reason ?? 'approved',
        requested_by_user_id: input.requestedByUserId ?? null,
      },
      source: 'knowledge_embedding_service',
    });
  }

  async enqueueEmbeddingJobs(input: {
    clinicId: string;
    knowledgeEntryIds: string[];
    requestedByUserId?: string;
    reason?: EmbeddingJobReason;
  }): Promise<BulkEmbeddingEnqueueResult> {
    const knowledgeEntryIds = Array.from(new Set(input.knowledgeEntryIds));
    if (knowledgeEntryIds.length === 0) {
      return { queuedKnowledgeIds: [], failedKnowledgeIds: [] };
    }

    const reason = input.reason ?? 'approved';

    try {
      await this.queueService.enqueueBulk(
        knowledgeEntryIds.map((knowledgeEntryId) => ({
          queue: JOB_QUEUE_MAP[JOB_TYPES.GENERATE_KNOWLEDGE_EMBEDDING],
          jobType: JOB_TYPES.GENERATE_KNOWLEDGE_EMBEDDING,
          clinicId: input.clinicId,
          payload: {
            clinic_id: input.clinicId,
            knowledge_entry_id: knowledgeEntryId,
            ...(input.requestedByUserId
              ? { requested_by_user_id: input.requestedByUserId }
              : {}),
            reason,
          },
        })),
      );
    } catch {
      // BullMQ addBulk is a single operation for this queue, so a backend failure
      // cannot be attributed to one item. Report every ID in the failed batch.
      return { queuedKnowledgeIds: [], failedKnowledgeIds: knowledgeEntryIds };
    }

    try {
      await this.dbService.insertAuditLog({
        clinicId: input.clinicId,
        actorType: 'system',
        eventType: 'knowledge_embedding_jobs_bulk_queued',
        entityType: 'clinic_knowledge_base',
        eventData: {
          knowledge_entry_ids: knowledgeEntryIds,
          knowledge_entry_count: knowledgeEntryIds.length,
          reason,
          requested_by_user_id: input.requestedByUserId ?? null,
        },
        source: 'knowledge_embedding_service',
      });
    } catch (error) {
      // The jobs are already queued. Audit logging is best-effort here so an
      // audit write failure cannot incorrectly mark successfully queued jobs as failed.
      this.logger.warn(
        JSON.stringify({
          event: 'knowledge_embedding_bulk_queue_audit_failed',
          clinic_id: input.clinicId,
          knowledge_entry_count: knowledgeEntryIds.length,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    return { queuedKnowledgeIds: knowledgeEntryIds, failedKnowledgeIds: [] };
  }

  async generateEmbedding(clinicId: string, knowledgeEntryId: string, jobId?: string | null) {
    const [row] = await this.repos.knowledge.findKnowledgeEntry(clinicId, knowledgeEntryId);
    if (!row) {
      return { status: 'not_found' as const };
    }

    const isManualTemplateEntry = Boolean(row.templateKey || row.sectionKey);

    if (row.status !== 'approved' && !isManualTemplateEntry) {
      await this.repos.knowledge.markEmbeddingNotRequired(clinicId, knowledgeEntryId);
      return { status: 'not_required' as const };
    }

    const searchText = buildKnowledgeSearchText({
      question: row.question,
      answer: row.answer,
      category: row.category,
      alternativePhrases: (row.alternativePhrasesJson as string[] | null) ?? [],
    });

    const sourceHash = computeEmbeddingSourceHash(searchText, this.env.EMBEDDING_MODEL);
    if (
      row.embeddingStatus === 'generated' &&
      row.embeddingSourceHash === sourceHash &&
      row.embeddingModel === this.env.EMBEDDING_MODEL
    ) {
      return { status: 'skipped' as const, sourceHash };
    }

    await this.repos.knowledge.updateKnowledgeEntry(clinicId, knowledgeEntryId, {
      searchText,
      embeddingStatus: 'pending',
    });

    try {
      const [embedding, questionEmbedding, answerEmbedding] = await Promise.all([
        this.embeddingProvider.embed({
          text: searchText,
          clinicId,
          knowledgeId: knowledgeEntryId,
        }),
        this.embeddingProvider.embed({
          text: row.question,
          clinicId,
          knowledgeId: knowledgeEntryId,
        }),
        this.embeddingProvider.embed({
          text: row.answer,
          clinicId,
          knowledgeId: knowledgeEntryId,
        }),
      ]);

      for (const result of [embedding, questionEmbedding, answerEmbedding]) {
        if (result.dimensions !== this.env.EMBEDDING_DIMENSIONS) {
          throw new Error(
            `embedding_dimension_mismatch expected=${this.env.EMBEDDING_DIMENSIONS} actual=${result.dimensions}`,
          );
        }
      }

      await this.repos.knowledge.updateEmbedding({
        clinicId,
        knowledgeId: knowledgeEntryId,
        vector: embedding.vector,
        questionVector: questionEmbedding.vector,
        answerVector: answerEmbedding.vector,
        model: embedding.model,
        dimensions: embedding.dimensions,
        sourceHash,
        jobId: jobId ?? null,
      });

      await this.dbService.insertAuditLog({
        clinicId,
        actorType: 'system',
        eventType: 'knowledge_embedding_generated',
        entityType: 'clinic_knowledge_base',
        entityId: knowledgeEntryId,
        eventData: {
          embedding_model: embedding.model,
          embedding_dimensions: embedding.dimensions,
          source_hash: sourceHash,
        },
        source: 'knowledge_embedding_service',
      });

      return { status: 'generated' as const, sourceHash };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'embedding_generation_failed';
      await this.repos.knowledge.markEmbeddingFailed(clinicId, knowledgeEntryId, message);

      await this.dbService.insertAuditLog({
        clinicId,
        actorType: 'system',
        eventType: 'knowledge_embedding_failed',
        entityType: 'clinic_knowledge_base',
        entityId: knowledgeEntryId,
        eventData: { error: message },
        source: 'knowledge_embedding_service',
      });

      return { status: 'failed' as const, error: message };
    }
  }

  async bulkRegenerateEmbeddings(input: {
    clinicId: string;
    onlyStatus?: 'approved' | 'all';
    requestedByUserId?: string;
  }) {
    const rows = await this.repos.knowledge.listKnowledgeForEmbeddingRegenerate(
      input.clinicId,
      input.onlyStatus ?? 'approved',
    );

    let queued = 0;
    for (const row of rows) {
      if (row.status !== 'approved') {
        continue;
      }

      await this.repos.knowledge.updateKnowledgeEntry(input.clinicId, row.id, {
        embeddingStatus: 'pending',
      });
      await this.enqueueEmbeddingJob({
        clinicId: input.clinicId,
        knowledgeEntryId: row.id,
        ...(input.requestedByUserId ? { requestedByUserId: input.requestedByUserId } : {}),
        reason: 'bulk_regenerate',
      });
      queued += 1;
    }

    return { queued };
  }
}
