import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiDelete, apiPatch, apiPost } from '@/lib/api/client';
import {
  bulkApproveKnowledgeEntries,
  bulkApproveKnowledgeEntriesInChunks,
  createManualKnowledgeSection,
  MAX_KNOWLEDGE_BULK_APPROVAL_SIZE,
  patchKnowledgeEntry,
  removeManualKnowledgeQuestion,
  removeManualKnowledgeSection,
  updateManualKnowledgeSection,
} from '@/lib/api/knowledge';

vi.mock('@/lib/api/client', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}));

const mockedApiDelete = vi.mocked(apiDelete);
const mockedApiPost = vi.mocked(apiPost);
const mockedApiPatch = vi.mocked(apiPatch);

beforeEach(() => {
  mockedApiDelete.mockReset();
  mockedApiPost.mockReset();
  mockedApiPatch.mockReset();
});

describe('knowledge mutation response normalization', () => {
  it('normalizes the camelCase knowledge row returned by the API', async () => {
    mockedApiPatch.mockResolvedValue({
      knowledge: {
        id: '039aac2c-3b21-474c-963d-8d602cd802fa',
        clinicId: '8f64a579-f674-4afc-932a-ab5b54f6b3ec',
        question: 'Can I share photos or documents before visit?',
        answer: 'yes u can share photos',
        category: 'communication',
        alternativePhrasesJson: [],
        sourceFileId: null,
        sourceFile: 'Vaidya Clinic Knowledge Base Q&A Template',
        sourcePage: null,
        templateKey: 'communication::Can I share photos or documents before visit?',
        sectionKey: 'communication',
        sourceNotes: 'Do not give diagnosis advice.',
        serviceName: null,
        applicable: true,
        qaApproved: true,
        status: 'needs_update',
        searchText:
          'Category: communication Question: Can I share photos or documents before visit? Answer: yes u can share photos',
        embeddingModel: null,
        embeddingDimensions: null,
        embeddingStatus: 'failed',
        embeddingGeneratedAt: null,
        embeddingError: 'expected 1024 dimensions, received 768',
        embeddingSourceHash: null,
        lastEmbeddingJobId: null,
        approvedByUserId: null,
        approvedAt: null,
        createdAt: '2026-09-24T13:39:31.186Z',
        updatedAt: '2026-09-24T17:46:11.997Z',
      },
    });

    const result = await patchKnowledgeEntry(
      '039aac2c-3b21-474c-963d-8d602cd802fa',
      { answer: 'yes u can share photos' },
      '8f64a579-f674-4afc-932a-ab5b54f6b3ec',
    );

    expect(result).toMatchObject({
      id: '039aac2c-3b21-474c-963d-8d602cd802fa',
      clinic_id: '8f64a579-f674-4afc-932a-ab5b54f6b3ec',
      alternative_phrases_json: [],
      template_key: 'communication::Can I share photos or documents before visit?',
      section_key: 'communication',
      source_notes: 'Do not give diagnosis advice.',
      qa_approved: true,
      embedding_status: 'failed',
      created_at: '2026-09-24T13:39:31.186Z',
      updated_at: '2026-09-24T17:46:11.997Z',
    });
    expect(result.alternative_phrases_json).toHaveLength(0);
  });
});

describe('manual knowledge section API', () => {
  it('creates and renames sections through the section endpoints', async () => {
    mockedApiPost.mockResolvedValue({
      section: {
        key: 'custom_billing_12345678',
        title: 'Billing',
        is_custom: true,
        questions: [],
      },
    });
    mockedApiPatch.mockResolvedValue({
      section: {
        key: 'custom_billing_12345678',
        title: 'Billing and Receipts',
        is_custom: true,
      },
    });

    await expect(createManualKnowledgeSection('Billing')).resolves.toMatchObject({
      title: 'Billing',
    });
    await expect(
      updateManualKnowledgeSection('custom_billing_12345678', 'Billing and Receipts'),
    ).resolves.toMatchObject({ title: 'Billing and Receipts' });
    expect(mockedApiPost).toHaveBeenCalledWith('/v1/knowledge/manual-template/sections', {
      title: 'Billing',
    });
    expect(mockedApiPatch).toHaveBeenCalledWith(
      '/v1/knowledge/manual-template/sections/custom_billing_12345678',
      { title: 'Billing and Receipts' },
    );
  });

  it('encodes section keys and virtual question IDs when removing them', async () => {
    mockedApiDelete.mockResolvedValue({ result: { removed: true } });

    await removeManualKnowledgeSection('custom/section');
    await removeManualKnowledgeQuestion('template:visit:Can I walk in?');

    expect(mockedApiDelete).toHaveBeenNthCalledWith(
      1,
      '/v1/knowledge/manual-template/sections/custom%2Fsection',
    );
    expect(mockedApiDelete).toHaveBeenNthCalledWith(
      2,
      '/v1/knowledge/manual-template/questions?knowledge_id=template%3Avisit%3ACan%20I%20walk%20in%3F',
    );
  });
});

describe('knowledge bulk approval API', () => {
  it('sends one bulk request for up to 100 knowledge entries', async () => {
    const ids = Array.from(
      { length: MAX_KNOWLEDGE_BULK_APPROVAL_SIZE },
      (_, index) => `qa-${index}`,
    );
    mockedApiPost.mockResolvedValue({
      result: {
        requested: ids.length,
        approved: ids.length,
        skipped: 0,
        knowledge_ids: ids,
        skipped_knowledge_ids: [],
        embedding_jobs_queued: ids.length,
        embedding_jobs_failed: 0,
        embedding_job_failed_knowledge_ids: [],
        embedding_failure_state_persisted: true,
      },
    });

    await expect(bulkApproveKnowledgeEntries(ids)).resolves.toMatchObject({
      approved: ids.length,
      knowledge_ids: ids,
    });
    expect(mockedApiPost).toHaveBeenCalledOnce();
    expect(mockedApiPost).toHaveBeenCalledWith('/v1/knowledge/bulk-approve', {
      knowledge_ids: ids,
    });
  });

  it('splits more than 100 entries into sequential bulk requests', async () => {
    const ids = Array.from({ length: 205 }, (_, index) => `qa-${index}`);
    const completedChunks: string[][] = [];
    let activeRequests = 0;
    let maximumConcurrentRequests = 0;

    mockedApiPost.mockImplementation(async (_path, body) => {
      const chunkIds = (body as { knowledge_ids: string[] }).knowledge_ids;
      activeRequests += 1;
      maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests);
      await Promise.resolve();
      activeRequests -= 1;
      return {
        result: {
          requested: chunkIds.length,
          approved: chunkIds.length,
          skipped: 0,
          knowledge_ids: chunkIds,
          skipped_knowledge_ids: [],
          embedding_jobs_queued: chunkIds.length,
          embedding_jobs_failed: 0,
          embedding_job_failed_knowledge_ids: [],
          embedding_failure_state_persisted: true,
        },
      };
    });

    const results = await bulkApproveKnowledgeEntriesInChunks(ids, (result) => {
      completedChunks.push(result.knowledge_ids);
    });

    expect(mockedApiPost).toHaveBeenCalledTimes(3);
    expect(
      mockedApiPost.mock.calls.map(
        ([, body]) => (body as { knowledge_ids: string[] }).knowledge_ids.length,
      ),
    ).toEqual([100, 100, 5]);
    expect(results).toHaveLength(3);
    expect(completedChunks.flat()).toEqual(ids);
    expect(maximumConcurrentRequests).toBe(1);
  });

  it('does not submit another chunk or publish a completed chunk after its context expires', async () => {
    const ids = Array.from({ length: 205 }, (_, index) => `qa-${index}`);
    let activeContext = true;
    const onChunkApproved = vi.fn();

    mockedApiPost.mockImplementation(async (_path, body) => {
      const chunkIds = (body as { knowledge_ids: string[] }).knowledge_ids;
      activeContext = false;
      return {
        result: {
          requested: chunkIds.length,
          approved: chunkIds.length,
          skipped: 0,
          knowledge_ids: chunkIds,
          skipped_knowledge_ids: [],
          embedding_jobs_queued: chunkIds.length,
          embedding_jobs_failed: 0,
          embedding_job_failed_knowledge_ids: [],
          embedding_failure_state_persisted: true,
        },
      };
    });

    const results = await bulkApproveKnowledgeEntriesInChunks(
      ids,
      onChunkApproved,
      () => activeContext,
    );

    expect(mockedApiPost).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(onChunkApproved).not.toHaveBeenCalled();
  });

  it('rejects an invalid direct bulk request before calling the API', async () => {
    await expect(bulkApproveKnowledgeEntries([])).rejects.toBeInstanceOf(RangeError);
    await expect(
      bulkApproveKnowledgeEntries(
        Array.from({ length: MAX_KNOWLEDGE_BULK_APPROVAL_SIZE + 1 }, (_, index) => `qa-${index}`),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    expect(mockedApiPost).not.toHaveBeenCalled();
  });
});
