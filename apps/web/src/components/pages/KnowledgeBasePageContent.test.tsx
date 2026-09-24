import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeBasePageContent } from './KnowledgeBasePageContent';
import {
  bulkApproveKnowledgeEntriesInChunks,
  fetchKnowledgeEmbeddingStatus,
  fetchKnowledgeEntries,
  type KnowledgeEntryApiRow,
} from '@/lib/api/knowledge';
import { subscribeToClinicKnowledge } from '@/lib/supabase-realtime';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ effectiveRole: 'admin' }),
}));

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => '00000000-0000-0000-0000-000000000001',
}));

vi.mock('@/lib/api/knowledge', () => ({
  bulkApproveKnowledgeEntriesInChunks: vi.fn(),
  createManualKnowledgeEntry: vi.fn(),
  fetchKnowledgeEmbeddingStatus: vi.fn(),
  fetchKnowledgeEntries: vi.fn(),
  fetchManualKnowledgeTemplate: vi.fn(),
  importManualKnowledgeTemplate: vi.fn(),
  patchKnowledgeEntry: vi.fn(),
}));

vi.mock('@/lib/supabase-realtime', () => ({
  subscribeToClinicKnowledge: vi.fn(),
}));

const mockedBulkApprove = vi.mocked(bulkApproveKnowledgeEntriesInChunks);
const mockedFetchEntries = vi.mocked(fetchKnowledgeEntries);
const mockedFetchEmbeddingStatus = vi.mocked(fetchKnowledgeEmbeddingStatus);
const mockedSubscribe = vi.mocked(subscribeToClinicKnowledge);

function knowledgeRow(id: string): KnowledgeEntryApiRow {
  return {
    id,
    clinic_id: '00000000-0000-0000-0000-000000000001',
    question: `Question ${id}`,
    answer: `Answer ${id}`,
    category: 'general',
    alternative_phrases_json: [],
    template_key: null,
    section_key: null,
    source_notes: null,
    service_name: null,
    applicable: true,
    qa_approved: false,
    status: 'pending_review',
    source_file: null,
    source_page: null,
    embedding_status: 'not_required',
    embedding_model: null,
    embedding_generated_at: null,
    search_text: null,
    approved_at: null,
    created_at: '2026-09-24T00:00:00.000Z',
    updated_at: '2026-09-24T00:00:00.000Z',
  };
}

beforeEach(() => {
  mockedBulkApprove.mockReset();
  mockedFetchEntries.mockReset().mockResolvedValue([]);
  mockedFetchEmbeddingStatus.mockReset().mockResolvedValue(null);
  mockedSubscribe.mockReset().mockReturnValue(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('KnowledgeBasePageContent bulk refresh behavior', () => {
  it('coalesces a burst of realtime row changes into one knowledge reload', async () => {
    render(<KnowledgeBasePageContent />);

    expect(await screen.findByText('No pending entries to review')).toBeInTheDocument();
    await waitFor(() => expect(mockedSubscribe).toHaveBeenCalledOnce());
    expect(mockedFetchEntries).toHaveBeenCalledOnce();

    const onRealtimeChange = mockedSubscribe.mock.calls[0]?.[1];
    expect(onRealtimeChange).toBeDefined();
    vi.useFakeTimers();

    act(() => {
      onRealtimeChange?.();
      onRealtimeChange?.();
      onRealtimeChange?.();
    });
    expect(mockedFetchEntries).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(mockedFetchEntries).toHaveBeenCalledTimes(2);
  });

  it('keeps skipped entries selected and warns about skipped and embedding-failed entries', async () => {
    const approved = knowledgeRow('00000000-0000-0000-0000-000000000101');
    const skipped = knowledgeRow('00000000-0000-0000-0000-000000000102');
    mockedFetchEntries
      .mockResolvedValueOnce([approved, skipped])
      .mockResolvedValueOnce([skipped]);
    mockedBulkApprove.mockImplementation(async (_ids, onChunkApproved) => {
      const result = {
        requested: 2,
        approved: 1,
        skipped: 1,
        knowledge_ids: [approved.id],
        skipped_knowledge_ids: [skipped.id],
        skipped_entries: [
          {
            knowledge_id: skipped.id,
            reason: 'changed_during_approval' as const,
          },
        ],
        embedding_jobs_queued: 0,
        embedding_jobs_failed: 1,
        embedding_job_failed_knowledge_ids: [approved.id],
        embedding_failure_state_persisted: true,
      };
      onChunkApproved?.(result);
      return [result];
    });

    render(<KnowledgeBasePageContent />);
    expect(await screen.findByText(`Question ${approved.id}`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected (2)' }));

    expect(
      await screen.findByText(/1 entry changed during approval and must be reviewed again/),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 approved entry needs an embedding retry/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Approve selected (1)' })).toBeEnabled();
    });
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});
