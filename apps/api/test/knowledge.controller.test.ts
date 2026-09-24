import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext } from '@vaidya/shared';

import { AUTH_CONTEXT_KEY } from '../src/common/guards/auth.guard';
import { KnowledgeAdminService } from '../src/modules/knowledge/knowledge-admin.service';
import { KnowledgeController } from '../src/modules/knowledge/knowledge.controller';

const AUTH_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_CLINIC_ID = '00000000-0000-0000-0000-000000000099';
const USER_ID = '00000000-0000-0000-0000-000000000102';
const KNOWLEDGE_ID = '00000000-0000-0000-0000-000000000501';

function requestWithAuth(auth: AuthContext) {
  return {
    [AUTH_CONTEXT_KEY]: auth,
  } as unknown as FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext };
}

describe('KnowledgeController clinic scoping', () => {
  let controller: KnowledgeController;
  let knowledgeAdmin: {
    bulkApproveKnowledgeEntries: ReturnType<typeof vi.fn>;
    regenerateEmbeddings: ReturnType<typeof vi.fn>;
    retryEmbedding: ReturnType<typeof vi.fn>;
    patchKnowledgeEntry: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    knowledgeAdmin = {
      bulkApproveKnowledgeEntries: vi.fn().mockResolvedValue({
        requested: 1,
        approved: 1,
        skipped: 0,
        knowledge_ids: [KNOWLEDGE_ID],
        skipped_knowledge_ids: [],
        embedding_jobs_queued: 1,
        embedding_jobs_failed: 0,
        embedding_job_failed_knowledge_ids: [],
        embedding_failure_state_persisted: true,
      }),
      regenerateEmbeddings: vi.fn().mockResolvedValue({ queued: 0 }),
      retryEmbedding: vi.fn().mockResolvedValue({ queued: true }),
      patchKnowledgeEntry: vi.fn().mockResolvedValue({ id: KNOWLEDGE_ID }),
    };
    controller = new KnowledgeController(knowledgeAdmin as unknown as KnowledgeAdminService);
  });

  it('uses the authenticated clinic for every mutation', async () => {
    const request = requestWithAuth({
      userId: USER_ID,
      clinicId: AUTH_CLINIC_ID,
      clinicRole: 'clinic_admin',
    });

    await controller.regenerateEmbeddings(request, {
      clinic_id: OTHER_CLINIC_ID,
      only_status: 'all',
    });
    await controller.retryEmbedding(request, KNOWLEDGE_ID);
    await controller.patchKnowledgeEntry(request, KNOWLEDGE_ID, {
      clinic_id: OTHER_CLINIC_ID,
      question: 'Updated question',
    });
    await controller.bulkApproveKnowledgeEntries(request, {
      clinic_id: OTHER_CLINIC_ID,
      knowledge_ids: [KNOWLEDGE_ID],
    });

    expect(knowledgeAdmin.regenerateEmbeddings).toHaveBeenCalledWith({
      clinicId: AUTH_CLINIC_ID,
      onlyStatus: 'all',
      requestedByUserId: USER_ID,
    });
    expect(knowledgeAdmin.retryEmbedding).toHaveBeenCalledWith({
      clinicId: AUTH_CLINIC_ID,
      knowledgeId: KNOWLEDGE_ID,
      requestedByUserId: USER_ID,
    });
    expect(knowledgeAdmin.patchKnowledgeEntry).toHaveBeenCalledWith({
      clinicId: AUTH_CLINIC_ID,
      knowledgeId: KNOWLEDGE_ID,
      patch: expect.objectContaining({ question: 'Updated question' }),
      actorUserId: USER_ID,
    });
    expect(knowledgeAdmin.bulkApproveKnowledgeEntries).toHaveBeenCalledWith({
      clinicId: AUTH_CLINIC_ID,
      knowledgeIds: [KNOWLEDGE_ID],
      actorUserId: USER_ID,
    });
  });

  it('rejects mutations when no clinic context is authenticated', async () => {
    const request = requestWithAuth({ userId: USER_ID });

    await expect(
      controller.regenerateEmbeddings(request, { clinic_id: OTHER_CLINIC_ID }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(controller.retryEmbedding(request, KNOWLEDGE_ID)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      controller.patchKnowledgeEntry(request, KNOWLEDGE_ID, { question: 'Updated question' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      controller.bulkApproveKnowledgeEntries(request, { knowledge_ids: [KNOWLEDGE_ID] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(knowledgeAdmin.regenerateEmbeddings).not.toHaveBeenCalled();
    expect(knowledgeAdmin.retryEmbedding).not.toHaveBeenCalled();
    expect(knowledgeAdmin.patchKnowledgeEntry).not.toHaveBeenCalled();
    expect(knowledgeAdmin.bulkApproveKnowledgeEntries).not.toHaveBeenCalled();
  });

  it('rejects empty, invalid, and over-limit bulk approval payloads', async () => {
    const request = requestWithAuth({
      userId: USER_ID,
      clinicId: AUTH_CLINIC_ID,
      clinicRole: 'clinic_admin',
    });

    await expect(
      controller.bulkApproveKnowledgeEntries(request, { knowledge_ids: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      controller.bulkApproveKnowledgeEntries(request, { knowledge_ids: ['not-a-uuid'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      controller.bulkApproveKnowledgeEntries(request, {
        knowledge_ids: Array.from({ length: 101 }, () => KNOWLEDGE_ID),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(knowledgeAdmin.bulkApproveKnowledgeEntries).not.toHaveBeenCalled();
  });
});
