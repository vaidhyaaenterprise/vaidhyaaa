import { describe, expect, it, vi } from 'vitest';

import { KnowledgeAdminService } from '../src/modules/knowledge/knowledge-admin.service';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000102';
const KNOWLEDGE_ID_1 = '00000000-0000-0000-0000-000000000501';
const KNOWLEDGE_ID_2 = '00000000-0000-0000-0000-000000000502';

function createService(input?: { failedKnowledgeId?: string }) {
  const findKnowledgeEntriesByIds = vi.fn().mockResolvedValue([
    {
      id: KNOWLEDGE_ID_1,
      status: 'pending_review',
      applicable: true,
      answer: 'Parking is available near the clinic.',
    },
    {
      id: KNOWLEDGE_ID_2,
      status: 'needs_update',
      applicable: true,
      answer: 'The clinic opens at 9 AM.',
    },
  ]);
  const bulkApproveKnowledgeEntries = vi
    .fn()
    .mockResolvedValue([{ id: KNOWLEDGE_ID_1 }, { id: KNOWLEDGE_ID_2 }]);
  const enqueueEmbeddingJobs = vi.fn().mockImplementation(({ knowledgeEntryIds }) => {
    const failedKnowledgeIds = input?.failedKnowledgeId ? [input.failedKnowledgeId] : [];
    return Promise.resolve({
      queuedKnowledgeIds: knowledgeEntryIds.filter(
        (knowledgeEntryId: string) => knowledgeEntryId !== input?.failedKnowledgeId,
      ),
      failedKnowledgeIds,
    });
  });
  const bulkMarkEmbeddingFailed = vi.fn().mockResolvedValue([{ id: KNOWLEDGE_ID_2 }]);

  const service = Object.create(KnowledgeAdminService.prototype) as KnowledgeAdminService;
  Reflect.set(service, 'repos', {
    knowledge: {
      findKnowledgeEntriesByIds,
      bulkApproveKnowledgeEntries,
      bulkMarkEmbeddingFailed,
    },
  });
  Reflect.set(service, 'embeddingService', { enqueueEmbeddingJobs });

  return {
    service,
    findKnowledgeEntriesByIds,
    bulkApproveKnowledgeEntries,
    bulkMarkEmbeddingFailed,
    enqueueEmbeddingJobs,
  };
}

describe('KnowledgeAdminService bulk approval', () => {
  it('updates all selected entries once and queues embeddings for approved rows', async () => {
    const { service, bulkApproveKnowledgeEntries, enqueueEmbeddingJobs } = createService();

    const result = await service.bulkApproveKnowledgeEntries({
      clinicId: CLINIC_ID,
      knowledgeIds: [KNOWLEDGE_ID_1, KNOWLEDGE_ID_2, KNOWLEDGE_ID_1],
      actorUserId: USER_ID,
    });

    expect(bulkApproveKnowledgeEntries).toHaveBeenCalledTimes(1);
    expect(bulkApproveKnowledgeEntries).toHaveBeenCalledWith(
      CLINIC_ID,
      [
        {
          id: KNOWLEDGE_ID_1,
          answer: 'Parking is available near the clinic.',
        },
        {
          id: KNOWLEDGE_ID_2,
          answer: 'The clinic opens at 9 AM.',
        },
      ],
      USER_ID,
    );
    expect(enqueueEmbeddingJobs).toHaveBeenCalledTimes(1);
    expect(enqueueEmbeddingJobs).toHaveBeenCalledWith({
      clinicId: CLINIC_ID,
      knowledgeEntryIds: [KNOWLEDGE_ID_1, KNOWLEDGE_ID_2],
      requestedByUserId: USER_ID,
      reason: 'approved',
    });
    expect(result).toEqual({
      requested: 2,
      approved: 2,
      skipped: 0,
      knowledge_ids: [KNOWLEDGE_ID_1, KNOWLEDGE_ID_2],
      skipped_knowledge_ids: [],
      embedding_jobs_queued: 2,
      embedding_jobs_failed: 0,
      embedding_job_failed_knowledge_ids: [],
      embedding_failure_state_persisted: true,
    });
  });

  it('keeps the bulk approval successful when one background embedding enqueue fails', async () => {
    const { service, bulkMarkEmbeddingFailed } = createService({
      failedKnowledgeId: KNOWLEDGE_ID_2,
    });

    const result = await service.bulkApproveKnowledgeEntries({
      clinicId: CLINIC_ID,
      knowledgeIds: [KNOWLEDGE_ID_1, KNOWLEDGE_ID_2],
      actorUserId: USER_ID,
    });

    expect(result.approved).toBe(2);
    expect(result.embedding_jobs_queued).toBe(1);
    expect(result.embedding_jobs_failed).toBe(1);
    expect(result.embedding_job_failed_knowledge_ids).toEqual([KNOWLEDGE_ID_2]);
    expect(result.embedding_failure_state_persisted).toBe(true);
    expect(bulkMarkEmbeddingFailed).toHaveBeenCalledWith(
      CLINIC_ID,
      [KNOWLEDGE_ID_2],
      'embedding_job_enqueue_failed',
    );
  });

  it('rejects the whole bulk approval before updating when any eligible answer is medical', async () => {
    const { service, findKnowledgeEntriesByIds, bulkApproveKnowledgeEntries } = createService();
    findKnowledgeEntriesByIds.mockResolvedValue([
      {
        id: KNOWLEDGE_ID_1,
        status: 'pending_review',
        applicable: true,
        answer: 'Parking is available near the clinic.',
      },
      {
        id: KNOWLEDGE_ID_2,
        status: 'pending_review',
        applicable: true,
        answer: 'Take one tablet after food.',
      },
    ]);

    await expect(
      service.bulkApproveKnowledgeEntries({
        clinicId: CLINIC_ID,
        knowledgeIds: [KNOWLEDGE_ID_1, KNOWLEDGE_ID_2],
        actorUserId: USER_ID,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(bulkApproveKnowledgeEntries).not.toHaveBeenCalled();
  });

  it('returns unavailable IDs as skipped instead of silently dropping them', async () => {
    const { service, findKnowledgeEntriesByIds, bulkApproveKnowledgeEntries } = createService();
    findKnowledgeEntriesByIds.mockResolvedValue([
      {
        id: KNOWLEDGE_ID_1,
        status: 'pending_review',
        applicable: true,
        answer: 'Parking is available near the clinic.',
      },
    ]);
    bulkApproveKnowledgeEntries.mockResolvedValue([{ id: KNOWLEDGE_ID_1 }]);

    const result = await service.bulkApproveKnowledgeEntries({
      clinicId: CLINIC_ID,
      knowledgeIds: [KNOWLEDGE_ID_1, KNOWLEDGE_ID_2],
      actorUserId: USER_ID,
    });

    expect(result.approved).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.skipped_knowledge_ids).toEqual([KNOWLEDGE_ID_2]);
  });
});
