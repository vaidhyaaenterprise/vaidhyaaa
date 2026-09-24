'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { ManualQAForm } from '@/components/pages/knowledge-base/ManualQAForm';
import { DocxUpload } from '@/components/pages/knowledge-base/DocxUpload';
import { ReviewQueue } from '@/components/pages/knowledge-base/ReviewQueue';
import { ApprovedQA } from '@/components/pages/knowledge-base/ApprovedQA';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { KNOWLEDGE_CATEGORIES } from '@/components/pages/knowledge-base/knowledge-categories';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import {
  bulkApproveKnowledgeEntriesInChunks,
  fetchKnowledgeEmbeddingStatus,
  fetchKnowledgeEntries,
  patchKnowledgeEntry,
  type BulkKnowledgeApprovalSkippedEntry,
  type KnowledgeEntryApiRow,
} from '@/lib/api/knowledge';
import { subscribeToClinicKnowledge } from '@/lib/supabase-realtime';
import type { KnowledgeEntry, KnowledgeFile } from '@/components/pages/knowledge-base/types';

const REALTIME_RELOAD_DEBOUNCE_MS = 350;

function mapEntry(row: KnowledgeEntryApiRow): KnowledgeEntry {
  const normalizedStatus =
    row.status === 'approved' ||
    row.status === 'disabled' ||
    row.status === 'pending_review' ||
    row.status === 'needs_update'
      ? row.status
      : 'pending_review';

  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    category: row.category ?? 'general',
    alternativePhrases: row.alternative_phrases_json,
    status: normalizedStatus,
    uiStatus:
      row.applicable === false
        ? 'inactive'
        : row.status === 'approved' && row.qa_approved
          ? 'approved'
          : 'draft',
    language: 'english',
    source: row.source_file ? 'upload' : 'manual',
    templateKey: row.template_key ?? undefined,
    sectionKey: row.section_key ?? undefined,
    sourceNotes: row.source_notes ?? undefined,
    serviceName: row.service_name ?? undefined,
    applicable: row.applicable,
    qaApproved: row.qa_approved,
    sourceFile: row.source_file ?? undefined,
    sourcePage: row.source_page ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function KnowledgeBasePageContent() {
  const { effectiveRole } = useAuth();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isManualFormOpen, setIsManualFormOpen] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<KnowledgeFile | null>(null);
  const [pendingEntries, setPendingEntries] = useState<KnowledgeEntry[]>([]);
  const [approvedEntries, setApprovedEntries] = useState<KnowledgeEntry[]>([]);
  const [embeddingStatus, setEmbeddingStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionWarning, setActionWarning] = useState<string | null>(null);
  const bulkUpdateInProgressRef = useRef(false);
  const realtimeReloadPendingRef = useRef(false);
  const realtimeReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadEntries = useCallback(
    async (showLoading = true) => {
      if (!isAdmin) {
        setLoading(false);
        return;
      }
      if (showLoading) {
        setLoading(true);
        setError(null);
      }
      try {
        const [entries, status] = await Promise.all([
          fetchKnowledgeEntries(),
          fetchKnowledgeEmbeddingStatus(),
        ]);
        const mapped = entries.map(mapEntry);
        setPendingEntries(
          mapped.filter(
            (entry) => entry.status === 'pending_review' || entry.status === 'needs_update',
          ),
        );
        setApprovedEntries(mapped.filter((entry) => entry.status === 'approved'));
        if (status) {
          setEmbeddingStatus(
            `${status.generated_count}/${status.approved_total} embeddings generated`,
          );
        }
      } catch (err) {
        if (showLoading) {
          setError(
            err instanceof ApiRequestError
              ? err.apiError.message
              : 'Failed to load knowledge base.',
          );
        }
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [isAdmin],
  );

  const applyKnowledgeRows = useCallback((rows: KnowledgeEntryApiRow[]) => {
    const changedIds = new Set(rows.map((row) => row.id));
    const changedEntries = rows.map(mapEntry);

    setPendingEntries((current) => [
      ...current.filter((entry) => !changedIds.has(entry.id)),
      ...changedEntries.filter(
        (entry) => entry.status === 'pending_review' || entry.status === 'needs_update',
      ),
    ]);
    setApprovedEntries((current) => [
      ...current.filter((entry) => !changedIds.has(entry.id)),
      ...changedEntries.filter((entry) => entry.status === 'approved'),
    ]);
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const scheduleRealtimeReload = useCallback(() => {
    realtimeReloadPendingRef.current = true;
    if (bulkUpdateInProgressRef.current) {
      return;
    }

    if (realtimeReloadTimerRef.current) {
      clearTimeout(realtimeReloadTimerRef.current);
    }
    realtimeReloadTimerRef.current = setTimeout(() => {
      realtimeReloadTimerRef.current = null;
      realtimeReloadPendingRef.current = false;
      void loadEntries(false);
    }, REALTIME_RELOAD_DEBOUNCE_MS);
  }, [loadEntries]);

  useEffect(() => {
    if (!isAdmin || !clinicId) {
      return;
    }

    return (
      subscribeToClinicKnowledge(clinicId, () => {
        scheduleRealtimeReload();
      }) ?? undefined
    );
  }, [clinicId, isAdmin, scheduleRealtimeReload]);

  useEffect(
    () => () => {
      if (realtimeReloadTimerRef.current) {
        clearTimeout(realtimeReloadTimerRef.current);
      }
    },
    [],
  );

  if (!isAdmin) {
    return (
      <>
        <PageHeader
          title="Knowledge base"
          description="Approved Q&A and document uploads that train Vaidya's answers."
        />
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Access denied. Knowledge base is admin-only.</p>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader
          title="Knowledge base"
          description="Approved Q&A from the clinic knowledge API."
        />
        <LoadingState title="Loading knowledge base" description="Fetching entries from the API." />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader
          title="Knowledge base"
          description="Approved Q&A from the clinic knowledge API."
        />
        <ErrorState title="Could not load knowledge base" description={error}>
          <button
            type="button"
            onClick={() => void loadEntries()}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white"
          >
            Retry
          </button>
        </ErrorState>
      </>
    );
  }

  const handleApprove = async (id: string) => {
    if (!clinicId) {
      return;
    }
    const updated = await patchKnowledgeEntry(
      id,
      { status: 'approved', qa_approved: true, applicable: true },
      clinicId,
    );
    applyKnowledgeRows([updated]);
  };

  const handleBulkApprove = async (ids: string[]) => {
    if (!clinicId) {
      const clinicContextError = new Error('Clinic context is required for bulk approval.');
      setActionError(clinicContextError.message);
      throw clinicContextError;
    }

    setActionError(null);
    setActionWarning(null);
    bulkUpdateInProgressRef.current = true;
    const requestedIds = new Set(ids);
    const selectedEntries = new Map(
      pendingEntries
        .filter((entry) => requestedIds.has(entry.id))
        .map((entry) => [entry.id, entry]),
    );
    let approvedCount = 0;
    const approvedKnowledgeIds: string[] = [];
    const skippedKnowledgeIds: string[] = [];
    const skippedEntries: BulkKnowledgeApprovalSkippedEntry[] = [];
    const embeddingFailedKnowledgeIds: string[] = [];
    let embeddingFailureStatePersisted = true;

    try {
      await bulkApproveKnowledgeEntriesInChunks(ids, (result) => {
        const approvedIds = new Set(result.knowledge_ids);
        approvedCount += result.approved;
        approvedKnowledgeIds.push(...result.knowledge_ids);
        skippedKnowledgeIds.push(...result.skipped_knowledge_ids);
        skippedEntries.push(...(result.skipped_entries ?? []));
        embeddingFailedKnowledgeIds.push(...result.embedding_job_failed_knowledge_ids);
        embeddingFailureStatePersisted =
          embeddingFailureStatePersisted && result.embedding_failure_state_persisted;

        setPendingEntries((current) => current.filter((entry) => !approvedIds.has(entry.id)));
        setApprovedEntries((current) => {
          const currentIds = new Set(current.map((entry) => entry.id));
          const newlyApproved = result.knowledge_ids
            .map((id) => selectedEntries.get(id))
            .filter((entry): entry is KnowledgeEntry => entry !== undefined)
            .filter((entry) => !currentIds.has(entry.id))
            .map((entry) => ({
              ...entry,
              status: 'approved' as const,
              uiStatus: 'approved' as const,
              applicable: true,
              qaApproved: true,
            }));
          return [...current, ...newlyApproved];
        });
      });

      const warnings: string[] = [];
      if (skippedKnowledgeIds.length > 0) {
        const countReason = (reason: BulkKnowledgeApprovalSkippedEntry['reason']) =>
          skippedEntries.filter((entry) => entry.reason === reason).length;
        const answerRequired = countReason('answer_required');
        const notApplicable = countReason('not_applicable');
        const statusNotReviewable = countReason('status_not_reviewable');
        const notFound = countReason('not_found_or_inaccessible');
        const changed = countReason('changed_during_approval');

        if (answerRequired > 0) {
          warnings.push(
            `${answerRequired} ${answerRequired === 1 ? 'entry needs an answer' : 'entries need answers'} before approval. Complete the answers and try again.`,
          );
        }
        if (notApplicable > 0) {
          warnings.push(
            `${notApplicable} inactive ${notApplicable === 1 ? 'entry was' : 'entries were'} not approved.`,
          );
        }
        if (statusNotReviewable > 0) {
          warnings.push(
            `${statusNotReviewable} ${statusNotReviewable === 1 ? 'entry is' : 'entries are'} no longer awaiting review.`,
          );
        }
        if (notFound > 0) {
          warnings.push(
            `${notFound} ${notFound === 1 ? 'entry was' : 'entries were'} not available for this clinic.`,
          );
        }
        if (changed > 0) {
          warnings.push(
            `${changed} ${changed === 1 ? 'entry changed' : 'entries changed'} during approval and must be reviewed again.`,
          );
        }
        if (skippedEntries.length === 0) {
          warnings.push(
            `${skippedKnowledgeIds.length} selected ${skippedKnowledgeIds.length === 1 ? 'entry was' : 'entries were'} not approved because the data changed or was no longer eligible. Unapproved entries remain selected for review.`,
          );
        }
      }
      if (embeddingFailedKnowledgeIds.length > 0) {
        warnings.push(
          embeddingFailureStatePersisted
            ? `${embeddingFailedKnowledgeIds.length} approved ${embeddingFailedKnowledgeIds.length === 1 ? 'entry needs' : 'entries need'} an embedding retry. The approval was saved and the retry state was recorded.`
            : `${embeddingFailedKnowledgeIds.length} approved ${embeddingFailedKnowledgeIds.length === 1 ? 'entry needs' : 'entries need'} an embedding retry. The approval was saved, but the retry state could not be recorded; retry embeddings manually.`,
        );
      }
      setActionWarning(warnings.length > 0 ? warnings.join(' ') : null);

      return {
        approvedIds: approvedKnowledgeIds,
        skippedIds: skippedKnowledgeIds,
      };
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.apiError.message
          : 'Bulk approval failed. Please try the remaining entries again.';
      setActionError(
        approvedCount > 0
          ? `${approvedCount} entries were approved before the request failed. ${message}`
          : message,
      );
      throw err;
    } finally {
      // All events emitted by completed chunks are covered by this refresh.
      // If another event arrives while the refresh is in flight, schedule one
      // final coalesced read after bulk mode is released.
      realtimeReloadPendingRef.current = false;
      await loadEntries(false);
      bulkUpdateInProgressRef.current = false;
      const needsFollowupReload = realtimeReloadPendingRef.current;
      realtimeReloadPendingRef.current = false;
      if (realtimeReloadTimerRef.current) {
        clearTimeout(realtimeReloadTimerRef.current);
        realtimeReloadTimerRef.current = null;
      }
      if (needsFollowupReload) {
        scheduleRealtimeReload();
      }
    }
  };

  const handleDisable = async (id: string) => {
    if (!clinicId) {
      return;
    }
    const updated = await patchKnowledgeEntry(
      id,
      { status: 'disabled', applicable: false },
      clinicId,
    );
    applyKnowledgeRows([updated]);
  };

  const handleEdit = async (id: string, updatedData: Partial<KnowledgeEntry>) => {
    if (!clinicId) {
      return;
    }
    const updated = await patchKnowledgeEntry(
      id,
      {
        ...(updatedData.question !== undefined ? { question: updatedData.question } : {}),
        ...(updatedData.answer !== undefined ? { answer: updatedData.answer } : {}),
        ...(updatedData.category !== undefined ? { category: updatedData.category } : {}),
        ...(updatedData.alternativePhrases !== undefined
          ? { alternative_phrases_json: updatedData.alternativePhrases }
          : {}),
      },
      clinicId,
    );
    applyKnowledgeRows([updated]);
  };

  const handleUpload = (file: File) => {
    setUploadStatus({
      id: Date.now().toString(),
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
      status: 'processing',
    });
  };

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description={
          embeddingStatus
            ? `Approved Q&A from API. Embeddings: ${embeddingStatus}.`
            : 'Approved Q&A loaded from the API.'
        }
      />

      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setIsManualFormOpen(true)}
          className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800"
        >
          Add manual Q&A
        </button>
      </div>

      {actionError && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
        >
          {actionError}
        </div>
      )}

      {actionWarning && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800"
        >
          {actionWarning}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <DocxUpload onUpload={handleUpload} uploadStatus={uploadStatus} />
        <ReviewQueue
          entries={pendingEntries}
          categories={KNOWLEDGE_CATEGORIES}
          onApprove={(id) => void handleApprove(id)}
          onBulkApprove={handleBulkApprove}
          onEdit={(id, data) => void handleEdit(id, data)}
          onDisable={(id) => void handleDisable(id)}
        />
        <ApprovedQA
          entries={approvedEntries}
          categories={KNOWLEDGE_CATEGORIES}
          onEdit={(id, data) => void handleEdit(id, data)}
          onDisable={(id) => void handleDisable(id)}
        />
      </div>

      <ManualQAForm
        isOpen={isManualFormOpen}
        onClose={() => setIsManualFormOpen(false)}
        categories={KNOWLEDGE_CATEGORIES}
        onSaved={() => {
          void loadEntries(false);
        }}
      />
    </>
  );
}
