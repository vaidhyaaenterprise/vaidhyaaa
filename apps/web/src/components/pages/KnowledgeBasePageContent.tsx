'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { ManualQAForm } from '@/components/pages/knowledge-base/ManualQAForm';
import { DocxUpload } from '@/components/pages/knowledge-base/DocxUpload';
import { ReviewQueue } from '@/components/pages/knowledge-base/ReviewQueue';
import { ApprovedQA } from '@/components/pages/knowledge-base/ApprovedQA';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import {
  fetchKnowledgeEmbeddingStatus,
  fetchKnowledgeEntries,
  patchKnowledgeEntry,
  type KnowledgeEntryApiRow,
} from '@/lib/api/knowledge';
import { subscribeToClinicKnowledge } from '@/lib/supabase-realtime';
import type { KnowledgeEntry, KnowledgeFile, Category } from '@/components/pages/knowledge-base/types';

const categories: Category[] = [
  { id: 'facility_info', name: 'Parking', description: 'Parking information' },
  { id: 'pre_visit_instruction', name: 'First Visit', description: 'First visit documents' },
  { id: 'pre_visit_instruction', name: 'Scan/Test Preparation', description: 'Scan preparation' },
  { id: 'insurance', name: 'Insurance', description: 'Insurance information' },
  { id: 'reports', name: 'Reports', description: 'Report collection' },
  { id: 'general', name: 'General FAQ', description: 'General FAQs' },
];

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

  const loadEntries = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [entries, status] = await Promise.all([
        fetchKnowledgeEntries(),
        fetchKnowledgeEmbeddingStatus(),
      ]);
      const mapped = entries.map(mapEntry);
      setPendingEntries(
        mapped.filter((entry) => entry.status === 'pending_review' || entry.status === 'needs_update'),
      );
      setApprovedEntries(mapped.filter((entry) => entry.status === 'approved'));
      if (status) {
        setEmbeddingStatus(
          `${status.generated_count}/${status.approved_total} embeddings generated`,
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.apiError.message : 'Failed to load knowledge base.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (!isAdmin || !clinicId) {
      return;
    }

    return subscribeToClinicKnowledge(clinicId, () => {
      void loadEntries();
    }) ?? undefined;
  }, [clinicId, isAdmin, loadEntries]);

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
        <PageHeader title="Knowledge base" description="Approved Q&A from the clinic knowledge API." />
        <LoadingState title="Loading knowledge base" description="Fetching entries from the API." />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Knowledge base" description="Approved Q&A from the clinic knowledge API." />
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
    await patchKnowledgeEntry(id, { status: 'approved', qa_approved: true, applicable: true }, clinicId);
    await loadEntries();
  };

  const handleBulkApprove = async (ids: string[]) => {
    if (!clinicId) {
      return;
    }
    for (const id of ids) {
      await patchKnowledgeEntry(id, { status: 'approved', qa_approved: true, applicable: true }, clinicId);
    }
    await loadEntries();
  };

  const handleDisable = async (id: string) => {
    if (!clinicId) {
      return;
    }
    await patchKnowledgeEntry(id, { status: 'disabled', applicable: false }, clinicId);
    await loadEntries();
  };

  const handleEdit = async (id: string, updatedData: Partial<KnowledgeEntry>) => {
    if (!clinicId) {
      return;
    }
    await patchKnowledgeEntry(
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
    await loadEntries();
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

      <div className="grid gap-4 lg:grid-cols-2">
        <DocxUpload onUpload={handleUpload} uploadStatus={uploadStatus} />
        <ReviewQueue
          entries={pendingEntries}
          categories={categories}
          onApprove={(id) => void handleApprove(id)}
          onBulkApprove={(ids) => void handleBulkApprove(ids)}
          onEdit={(id, data) => void handleEdit(id, data)}
          onDisable={(id) => void handleDisable(id)}
        />
        <ApprovedQA
          entries={approvedEntries}
          categories={categories}
          onEdit={(id, data) => void handleEdit(id, data)}
          onDisable={(id) => void handleDisable(id)}
        />
      </div>

      <ManualQAForm
        isOpen={isManualFormOpen}
        onClose={() => setIsManualFormOpen(false)}
        categories={categories}
        onSaved={() => loadEntries()}
      />
    </>
  );
}
