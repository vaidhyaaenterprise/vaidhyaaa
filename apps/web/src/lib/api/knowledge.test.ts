import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiPost } from '@/lib/api/client';
import {
  bulkApproveKnowledgeEntries,
  bulkApproveKnowledgeEntriesInChunks,
  MAX_KNOWLEDGE_BULK_APPROVAL_SIZE,
} from '@/lib/api/knowledge';

vi.mock('@/lib/api/client', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}));

const mockedApiPost = vi.mocked(apiPost);

beforeEach(() => {
  mockedApiPost.mockReset();
});

describe('knowledge bulk approval API', () => {
  it('sends one bulk request for up to 100 knowledge entries', async () => {
    const ids = Array.from({ length: MAX_KNOWLEDGE_BULK_APPROVAL_SIZE }, (_, index) => `qa-${index}`);
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
      mockedApiPost.mock.calls.map(([, body]) =>
        (body as { knowledge_ids: string[] }).knowledge_ids.length,
      ),
    ).toEqual([100, 100, 5]);
    expect(results).toHaveLength(3);
    expect(completedChunks.flat()).toEqual(ids);
    expect(maximumConcurrentRequests).toBe(1);
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
