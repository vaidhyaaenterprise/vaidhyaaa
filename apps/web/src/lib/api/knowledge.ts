import { apiGet, apiPatch, apiPost } from '@/lib/api/client';

export type KnowledgeEntryApiRow = {
  id: string;
  clinic_id: string;
  question: string;
  answer: string;
  category: string | null;
  alternative_phrases_json: string[];
  source_file_id?: string | null;
  template_key: string | null;
  section_key: string | null;
  source_notes: string | null;
  service_name: string | null;
  applicable: boolean;
  qa_approved: boolean;
  status: string;
  source_file: string | null;
  source_page: number | null;
  embedding_status: string;
  embedding_model: string | null;
  embedding_dimensions?: number | null;
  embedding_generated_at: string | null;
  embedding_error?: string | null;
  embedding_source_hash?: string | null;
  last_embedding_job_id?: string | null;
  search_text: string | null;
  approved_by_user_id?: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

type CamelCaseKnowledgeEntryApiRow = {
  clinicId?: string;
  alternativePhrasesJson?: unknown;
  sourceFileId?: string | null;
  templateKey?: string | null;
  sectionKey?: string | null;
  sourceNotes?: string | null;
  serviceName?: string | null;
  qaApproved?: boolean;
  sourceFile?: string | null;
  sourcePage?: number | null;
  embeddingStatus?: string;
  embeddingModel?: string | null;
  embeddingDimensions?: number | null;
  embeddingGeneratedAt?: string | null;
  embeddingError?: string | null;
  embeddingSourceHash?: string | null;
  lastEmbeddingJobId?: string | null;
  searchText?: string | null;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type KnowledgeEntryWireRow = Partial<KnowledgeEntryApiRow> &
  CamelCaseKnowledgeEntryApiRow &
  Pick<KnowledgeEntryApiRow, 'id' | 'question' | 'answer' | 'status'>;

export function normalizeKnowledgeEntryApiRow(row: KnowledgeEntryWireRow): KnowledgeEntryApiRow {
  const alternativePhrases = row.alternative_phrases_json ?? row.alternativePhrasesJson;

  return {
    id: row.id,
    clinic_id: row.clinic_id ?? row.clinicId ?? '',
    question: row.question,
    answer: row.answer,
    category: row.category ?? null,
    alternative_phrases_json: Array.isArray(alternativePhrases)
      ? alternativePhrases.filter((phrase): phrase is string => typeof phrase === 'string')
      : [],
    source_file_id: row.source_file_id ?? row.sourceFileId ?? null,
    template_key: row.template_key ?? row.templateKey ?? null,
    section_key: row.section_key ?? row.sectionKey ?? null,
    source_notes: row.source_notes ?? row.sourceNotes ?? null,
    service_name: row.service_name ?? row.serviceName ?? null,
    applicable: row.applicable ?? true,
    qa_approved: row.qa_approved ?? row.qaApproved ?? false,
    status: row.status,
    source_file: row.source_file ?? row.sourceFile ?? null,
    source_page: row.source_page ?? row.sourcePage ?? null,
    embedding_status: row.embedding_status ?? row.embeddingStatus ?? 'not_required',
    embedding_model: row.embedding_model ?? row.embeddingModel ?? null,
    embedding_dimensions: row.embedding_dimensions ?? row.embeddingDimensions ?? null,
    embedding_generated_at: row.embedding_generated_at ?? row.embeddingGeneratedAt ?? null,
    embedding_error: row.embedding_error ?? row.embeddingError ?? null,
    embedding_source_hash: row.embedding_source_hash ?? row.embeddingSourceHash ?? null,
    last_embedding_job_id: row.last_embedding_job_id ?? row.lastEmbeddingJobId ?? null,
    search_text: row.search_text ?? row.searchText ?? null,
    approved_by_user_id: row.approved_by_user_id ?? row.approvedByUserId ?? null,
    approved_at: row.approved_at ?? row.approvedAt ?? null,
    created_at: row.created_at ?? row.createdAt ?? '',
    updated_at: row.updated_at ?? row.updatedAt ?? '',
  };
}

export type TemplateUiStatus = 'draft' | 'approved' | 'inactive';

export type ManualTemplateQuestionApiRow = KnowledgeEntryApiRow & {
  exists: boolean;
  service_name_required: boolean;
  ui_status: TemplateUiStatus;
};

export type ManualTemplateSectionApiRow = {
  key: string;
  title: string;
  questions: ManualTemplateQuestionApiRow[];
};

export type ManualTemplateApiResponse = {
  source: string;
  sections: ManualTemplateSectionApiRow[];
  summary: {
    total: number;
    completed: number;
    approved: number;
    pending: number;
    not_applicable: number;
  };
};

export type CreateManualKnowledgeEntryPayload = {
  template_key?: string;
  section_key?: string;
  question: string;
  answer: string;
  category?: string;
  alternative_phrases_json?: string[];
  source_notes?: string;
  service_name?: string;
  applicable?: boolean;
  qa_approved?: boolean;
  source_file?: string;
  source_page?: number;
  status?: 'pending_review' | 'needs_update' | 'approved' | 'disabled';
};

export type KnowledgeEmbeddingStatus = {
  approved_total: number;
  generated_count: number;
  pending_count: number;
  failed_count: number;
  stale_count: number;
  not_required_count: number;
};

export const MAX_KNOWLEDGE_BULK_APPROVAL_SIZE = 100;

export type BulkKnowledgeApprovalSkipReason =
  | 'answer_required'
  | 'not_applicable'
  | 'status_not_reviewable'
  | 'not_found_or_inaccessible'
  | 'changed_during_approval';

export type BulkKnowledgeApprovalSkippedEntry = {
  knowledge_id: string;
  reason: BulkKnowledgeApprovalSkipReason;
};

export type BulkApproveKnowledgeResult = {
  requested: number;
  approved: number;
  skipped: number;
  knowledge_ids: string[];
  skipped_knowledge_ids: string[];
  // Optional while API and web deployments roll out independently.
  skipped_entries?: BulkKnowledgeApprovalSkippedEntry[];
  embedding_jobs_queued: number;
  embedding_jobs_failed: number;
  embedding_job_failed_knowledge_ids: string[];
  embedding_failure_state_persisted: boolean;
};

export async function fetchKnowledgeEntries() {
  const data = await apiGet<{ entries: KnowledgeEntryWireRow[] }>('/v1/knowledge/entries');
  return data.entries.map(normalizeKnowledgeEntryApiRow);
}

export async function fetchKnowledgeEmbeddingStatus() {
  const data = await apiGet<{ embedding_status: KnowledgeEmbeddingStatus | null }>(
    '/v1/knowledge/embedding-status',
  );
  return data.embedding_status;
}

export async function patchKnowledgeEntry(
  knowledgeId: string,
  patch: Record<string, unknown>,
  clinicId: string,
) {
  const data = await apiPatch<{ knowledge: KnowledgeEntryWireRow }>(`/v1/knowledge/${knowledgeId}`, {
    ...patch,
    clinic_id: clinicId,
  });
  return normalizeKnowledgeEntryApiRow(data.knowledge);
}

export async function bulkApproveKnowledgeEntries(knowledgeIds: string[]) {
  if (knowledgeIds.length === 0 || knowledgeIds.length > MAX_KNOWLEDGE_BULK_APPROVAL_SIZE) {
    throw new RangeError(
      `Bulk knowledge approval requires between 1 and ${MAX_KNOWLEDGE_BULK_APPROVAL_SIZE} entries.`,
    );
  }

  const data = await apiPost<{ result: BulkApproveKnowledgeResult }>(
    '/v1/knowledge/bulk-approve',
    { knowledge_ids: knowledgeIds },
  );
  return data.result;
}

export async function bulkApproveKnowledgeEntriesInChunks(
  knowledgeIds: string[],
  onChunkApproved?: (result: BulkApproveKnowledgeResult) => void,
) {
  const results: BulkApproveKnowledgeResult[] = [];

  for (
    let offset = 0;
    offset < knowledgeIds.length;
    offset += MAX_KNOWLEDGE_BULK_APPROVAL_SIZE
  ) {
    const result = await bulkApproveKnowledgeEntries(
      knowledgeIds.slice(offset, offset + MAX_KNOWLEDGE_BULK_APPROVAL_SIZE),
    );
    results.push(result);
    onChunkApproved?.(result);
  }

  return results;
}

export async function fetchManualKnowledgeTemplate() {
  const data = await apiGet<{ template: ManualTemplateApiResponse | null }>(
    '/v1/knowledge/manual-template',
  );
  return data.template;
}

export async function importManualKnowledgeTemplate() {
  const data = await apiPost<{ result: { imported: number; existing: number } }>(
    '/v1/knowledge/manual-template/import',
  );
  return data.result;
}

export async function createManualKnowledgeEntry(payload: CreateManualKnowledgeEntryPayload) {
  const data = await apiPost<{ knowledge: KnowledgeEntryWireRow }>('/v1/knowledge/manual', payload);
  return normalizeKnowledgeEntryApiRow(data.knowledge);
}

export async function regenerateKnowledgeEmbeddings(clinicId: string) {
  return apiPost<{ queued: number }>('/v1/knowledge/embeddings/regenerate', {
    clinic_id: clinicId,
    only_status: 'approved',
  });
}
