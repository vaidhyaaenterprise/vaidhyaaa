import { apiGet, apiPatch, apiPost } from '@/lib/api/client';

export type KnowledgeEntryApiRow = {
  id: string;
  clinic_id: string;
  question: string;
  answer: string;
  category: string | null;
  alternative_phrases_json: string[];
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
  embedding_generated_at: string | null;
  search_text: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

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

export async function fetchKnowledgeEntries() {
  const data = await apiGet<{ entries: KnowledgeEntryApiRow[] }>('/v1/knowledge/entries');
  return data.entries;
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
  const data = await apiPatch<{ knowledge: KnowledgeEntryApiRow }>(`/v1/knowledge/${knowledgeId}`, {
    ...patch,
    clinic_id: clinicId,
  });
  return data.knowledge;
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
  const data = await apiPost<{ knowledge: KnowledgeEntryApiRow }>('/v1/knowledge/manual', payload);
  return data.knowledge;
}

export async function regenerateKnowledgeEmbeddings(clinicId: string) {
  return apiPost<{ queued: number }>('/v1/knowledge/embeddings/regenerate', {
    clinic_id: clinicId,
    only_status: 'approved',
  });
}
