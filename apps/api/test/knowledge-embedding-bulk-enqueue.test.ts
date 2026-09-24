import { describe, expect, it, vi } from 'vitest';

import { JOB_QUEUE_MAP, JOB_TYPES } from '@vaidya/shared';

import { KnowledgeEmbeddingService } from '../src/modules/knowledge/knowledge-embedding.service';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000102';
const KNOWLEDGE_IDS = [
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000502',
];

function createService(input?: { queueFailure?: boolean; auditFailure?: boolean }) {
  const enqueueBulk = input?.queueFailure
    ? vi.fn().mockRejectedValue(new Error('queue unavailable'))
    : vi.fn().mockResolvedValue(['job-1', 'job-2']);
  const insertAuditLog = input?.auditFailure
    ? vi.fn().mockRejectedValue(new Error('audit unavailable'))
    : vi.fn().mockResolvedValue(undefined);

  const service = Object.create(KnowledgeEmbeddingService.prototype) as KnowledgeEmbeddingService;
  Reflect.set(service, 'queueService', { enqueueBulk });
  Reflect.set(service, 'dbService', { insertAuditLog });
  const warn = vi.fn();
  Reflect.set(service, 'logger', { warn });

  return { service, enqueueBulk, insertAuditLog, warn };
}

describe('KnowledgeEmbeddingService bulk enqueue', () => {
  it('enqueues one queue batch and writes one audit record', async () => {
    const { service, enqueueBulk, insertAuditLog } = createService();

    const result = await service.enqueueEmbeddingJobs({
      clinicId: CLINIC_ID,
      knowledgeEntryIds: [...KNOWLEDGE_IDS, KNOWLEDGE_IDS[0]!],
      requestedByUserId: USER_ID,
      reason: 'approved',
    });

    expect(enqueueBulk).toHaveBeenCalledTimes(1);
    expect(enqueueBulk).toHaveBeenCalledWith(
      KNOWLEDGE_IDS.map((knowledgeEntryId) => ({
        queue: JOB_QUEUE_MAP[JOB_TYPES.GENERATE_KNOWLEDGE_EMBEDDING],
        jobType: JOB_TYPES.GENERATE_KNOWLEDGE_EMBEDDING,
        clinicId: CLINIC_ID,
        payload: {
          clinic_id: CLINIC_ID,
          knowledge_entry_id: knowledgeEntryId,
          requested_by_user_id: USER_ID,
          reason: 'approved',
        },
      })),
    );
    expect(insertAuditLog).toHaveBeenCalledTimes(1);
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: CLINIC_ID,
        eventType: 'knowledge_embedding_jobs_bulk_queued',
        eventData: expect.objectContaining({
          knowledge_entry_ids: KNOWLEDGE_IDS,
          knowledge_entry_count: 2,
        }),
      }),
    );
    expect(result).toEqual({
      queuedKnowledgeIds: KNOWLEDGE_IDS,
      failedKnowledgeIds: [],
    });
  });

  it('reports every ID in a failed BullMQ batch and does not claim it was audited', async () => {
    const { service, enqueueBulk, insertAuditLog } = createService({ queueFailure: true });

    const result = await service.enqueueEmbeddingJobs({
      clinicId: CLINIC_ID,
      knowledgeEntryIds: KNOWLEDGE_IDS,
    });

    expect(enqueueBulk).toHaveBeenCalledTimes(1);
    expect(insertAuditLog).not.toHaveBeenCalled();
    expect(result).toEqual({
      queuedKnowledgeIds: [],
      failedKnowledgeIds: KNOWLEDGE_IDS,
    });
  });

  it('does not report queued jobs as failed when only audit logging fails', async () => {
    const { service, enqueueBulk, insertAuditLog, warn } = createService({ auditFailure: true });

    const result = await service.enqueueEmbeddingJobs({
      clinicId: CLINIC_ID,
      knowledgeEntryIds: KNOWLEDGE_IDS,
    });

    expect(enqueueBulk).toHaveBeenCalledTimes(1);
    expect(insertAuditLog).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('knowledge_embedding_bulk_queue_audit_failed'),
    );
    expect(result).toEqual({
      queuedKnowledgeIds: KNOWLEDGE_IDS,
      failedKnowledgeIds: [],
    });
  });
});
