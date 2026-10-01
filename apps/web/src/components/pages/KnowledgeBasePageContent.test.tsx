import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeBasePageContent } from './KnowledgeBasePageContent';
import {
  bulkApproveKnowledgeEntriesInChunks,
  fetchKnowledgeEmbeddingStatus,
  fetchKnowledgeEntries,
  patchKnowledgeEntry,
  type KnowledgeEntryApiRow,
} from '@/lib/api/knowledge';
import { subscribeToClinicKnowledge } from '@/lib/supabase-realtime';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_CLINIC_ID = '00000000-0000-0000-0000-000000000002';
let activeClinicId: string | null = CLINIC_ID;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ effectiveRole: 'admin' }),
}));

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => activeClinicId,
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
const mockedPatchKnowledgeEntry = vi.mocked(patchKnowledgeEntry);
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
  activeClinicId = CLINIC_ID;
  mockedBulkApprove.mockReset();
  mockedFetchEntries.mockReset().mockResolvedValue([]);
  mockedFetchEmbeddingStatus.mockReset().mockResolvedValue(null);
  mockedPatchKnowledgeEntry.mockReset();
  mockedSubscribe.mockReset().mockReturnValue(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('KnowledgeBasePageContent bulk refresh behavior', () => {
  it('does not request clinic knowledge without an active clinic context', async () => {
    activeClinicId = null;

    render(<KnowledgeBasePageContent />);

    expect(await screen.findByText('No pending entries to review')).toBeInTheDocument();
    expect(mockedFetchEntries).not.toHaveBeenCalled();
    expect(mockedFetchEmbeddingStatus).not.toHaveBeenCalled();
    expect(mockedSubscribe).not.toHaveBeenCalled();
  });

  it('shows the manual-template category names in the review queue', async () => {
    const visitPolicy = {
      ...knowledgeRow('00000000-0000-0000-0000-000000000201'),
      question: 'Do I need an appointment, or can I walk in?',
      category: 'visit_policy',
      template_key: 'visit_appointments::Do I need an appointment, or can I walk in?',
      section_key: 'visit_appointments',
    };
    const scanPreparation = {
      ...knowledgeRow('00000000-0000-0000-0000-000000000202'),
      question: 'For scan / ultrasound, is fasting required?',
      category: 'scan_preparation',
      template_key: 'tests_reports::For scan / ultrasound, is fasting required?',
      section_key: 'tests_reports',
    };
    mockedFetchEntries.mockResolvedValue([visitPolicy, scanPreparation]);

    render(<KnowledgeBasePageContent />);

    expect(await screen.findByText(visitPolicy.question)).toBeInTheDocument();
    expect(screen.getByText('Visit & Appointments')).toBeInTheDocument();
    expect(screen.getByText('Tests & Reports')).toBeInTheDocument();
    expect(screen.queryByText('visit_policy')).not.toBeInTheDocument();
    expect(screen.queryByText('scan_preparation')).not.toBeInTheDocument();
  });

  it('keeps unanswered drafts out of the review queue', async () => {
    const answered = {
      ...knowledgeRow('00000000-0000-0000-0000-000000000211'),
      status: 'needs_update',
    };
    const unanswered = {
      ...knowledgeRow('00000000-0000-0000-0000-000000000212'),
      answer: '',
      status: 'needs_update',
    };
    const whitespaceOnly = {
      ...knowledgeRow('00000000-0000-0000-0000-000000000213'),
      answer: '   \n\t',
      status: 'pending_review',
    };
    mockedFetchEntries.mockResolvedValue([answered, unanswered, whitespaceOnly]);

    render(<KnowledgeBasePageContent />);

    expect(await screen.findByText(answered.question)).toBeInTheDocument();
    expect(screen.queryByText(unanswered.question)).not.toBeInTheDocument();
    expect(screen.queryByText(whitespaceOnly.question)).not.toBeInTheDocument();
  });

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

  it('aborts the previous clinic load and ignores its stale response after a clinic switch', async () => {
    const firstClinicEntries = deferred<KnowledgeEntryApiRow[]>();
    const firstClinicRow = knowledgeRow('00000000-0000-0000-0000-000000000301');
    const secondClinicRow = {
      ...knowledgeRow('00000000-0000-0000-0000-000000000302'),
      clinic_id: OTHER_CLINIC_ID,
    };
    mockedFetchEntries
      .mockImplementationOnce(() => firstClinicEntries.promise)
      .mockResolvedValueOnce([secondClinicRow]);

    const { rerender } = render(<KnowledgeBasePageContent />);
    await waitFor(() => expect(mockedFetchEntries).toHaveBeenCalledOnce());
    const firstSignal = mockedFetchEntries.mock.calls[0]?.[0];

    activeClinicId = OTHER_CLINIC_ID;
    rerender(<KnowledgeBasePageContent />);

    expect(await screen.findByText(secondClinicRow.question)).toBeInTheDocument();
    expect(firstSignal?.aborted).toBe(true);

    await act(async () => {
      firstClinicEntries.resolve([firstClinicRow]);
      await firstClinicEntries.promise;
    });

    expect(screen.queryByText(firstClinicRow.question)).not.toBeInTheDocument();
    expect(screen.getByText(secondClinicRow.question)).toBeInTheDocument();
  });

  it('aborts an in-flight realtime reload when the page unmounts', async () => {
    render(<KnowledgeBasePageContent />);
    expect(await screen.findByText('No pending entries to review')).toBeInTheDocument();
    await waitFor(() => expect(mockedSubscribe).toHaveBeenCalledOnce());

    const realtimeEntries = deferred<KnowledgeEntryApiRow[]>();
    mockedFetchEntries.mockImplementationOnce(() => realtimeEntries.promise);
    const onRealtimeChange = mockedSubscribe.mock.calls[0]?.[1];
    vi.useFakeTimers();

    act(() => {
      onRealtimeChange?.();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(mockedFetchEntries).toHaveBeenCalledTimes(2);
    const realtimeSignal = mockedFetchEntries.mock.calls[1]?.[0];
    cleanup();
    expect(realtimeSignal?.aborted).toBe(true);

    await act(async () => {
      realtimeEntries.resolve([]);
      await realtimeEntries.promise;
    });
  });

  it('does not apply a completed approval to a newly selected clinic', async () => {
    const firstClinicRow = knowledgeRow('00000000-0000-0000-0000-000000000401');
    const secondClinicRow = {
      ...knowledgeRow('00000000-0000-0000-0000-000000000402'),
      clinic_id: OTHER_CLINIC_ID,
    };
    const approval = deferred<KnowledgeEntryApiRow>();
    mockedFetchEntries
      .mockResolvedValueOnce([firstClinicRow])
      .mockResolvedValueOnce([secondClinicRow]);
    mockedPatchKnowledgeEntry.mockImplementation(() => approval.promise);

    const { rerender } = render(<KnowledgeBasePageContent />);
    expect(await screen.findByText(firstClinicRow.question)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(mockedPatchKnowledgeEntry).toHaveBeenCalledWith(
      firstClinicRow.id,
      { status: 'approved', qa_approved: true, applicable: true },
      CLINIC_ID,
    );

    activeClinicId = OTHER_CLINIC_ID;
    rerender(<KnowledgeBasePageContent />);
    expect(await screen.findByText(secondClinicRow.question)).toBeInTheDocument();

    await act(async () => {
      approval.resolve({
        ...firstClinicRow,
        status: 'approved',
        qa_approved: true,
      });
      await approval.promise;
    });

    expect(screen.queryByText(firstClinicRow.question)).not.toBeInTheDocument();
    expect(screen.getByText(secondClinicRow.question)).toBeInTheDocument();
  });

  it('keeps skipped entries selected and warns about skipped and embedding-failed entries', async () => {
    const approved = knowledgeRow('00000000-0000-0000-0000-000000000101');
    const skipped = knowledgeRow('00000000-0000-0000-0000-000000000102');
    mockedFetchEntries.mockResolvedValueOnce([approved, skipped]).mockResolvedValueOnce([skipped]);
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
