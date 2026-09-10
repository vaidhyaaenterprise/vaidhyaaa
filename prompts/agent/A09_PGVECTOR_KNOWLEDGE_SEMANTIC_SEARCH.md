# A09 - pgvector Knowledge Semantic Search

## Purpose

Implement production-grade semantic search for Vaidya's clinic-approved Knowledge Base using PostgreSQL `pgvector`.

This milestone upgrades Knowledge Base retrieval from simple keyword search to semantic search while keeping Vaidya's safety rule intact:

```text
Only approved clinic knowledge can be used.
If no approved answer is found with enough confidence, Vaidya must say clinic staff will confirm.
```

Important distinction:

```text
LLM does not compare Q&A rows directly.
Backend KnowledgeService performs embedding search using PostgreSQL pgvector.
LLM may classify the user intent/topic and may later rephrase an approved answer, but it must not invent content.
```

This milestone should be implemented after:

```text
A04 - Structured Info and Knowledge Base
C05 - Redis/BullMQ Background Job Foundation
A06 - Jobs, Notifications, Workers
```

If those are not fully ready, implement A09 behind feature flags and keep simple text search as fallback.

---

## Non-negotiable design rules

1. PostgreSQL remains the source of truth.
2. Redis is not the source of truth.
3. Knowledge answers must be clinic-scoped.
4. Only `clinic_knowledge_base.status = 'approved'` rows can be used at runtime.
5. Pending, disabled, archived, failed, or needs-review knowledge must never be used for patient replies.
6. Structured DB always wins over Knowledge Base.
7. Do not use Knowledge Base for fees, timings, doctor schedules, holidays, location, services, slot availability, or appointment status.
8. Missing or low-confidence knowledge must fall back to `knowledge.no_answer`.
9. The LLM must not query the database, choose rows directly, or execute actions.
10. Every answer used from Knowledge Base must be auditable.

---

## What pgvector is used for

Use pgvector only for semantic retrieval over clinic-approved FAQ/Q&A content:

```text
parking
first visit documents
scan/test preparation
insurance/cashless explanation
report collection rules
clinic-specific instructions
approved general clinic FAQs
```

Do not use pgvector for:

```text
doctor fee
clinic timing
doctor availability
clinic location
appointment slots
service routing truth
cancel/reschedule status
patient visit records
```

Structured lookup handlers must answer those from structured tables.

---

## Required feature flags / environment variables

Add or confirm these env variables:

```env
KNOWLEDGE_SEARCH_PROVIDER=text
# text | pgvector | hybrid

EMBEDDING_PROVIDER=mock
# mock | sarvam | gemini | openai | other

EMBEDDING_MODEL=mock-embedding-v1
EMBEDDING_DIMENSIONS=768

KNOWLEDGE_VECTOR_MIN_SCORE=0.70
KNOWLEDGE_VECTOR_MAX_RESULTS=5
KNOWLEDGE_VECTOR_USE_HYBRID_FALLBACK=true
```

Recommended defaults:

```text
local/CI: KNOWLEDGE_SEARCH_PROVIDER=text, EMBEDDING_PROVIDER=mock
QA: KNOWLEDGE_SEARCH_PROVIDER=hybrid, EMBEDDING_PROVIDER=real provider if key exists
production: KNOWLEDGE_SEARCH_PROVIDER=hybrid or pgvector after QA quality pass
```

CI must not require a real embedding provider key.

---

## Database changes

### 1. Enable pgvector extension

Create a migration that enables the extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

If the managed Postgres provider does not support the extension in local/CI, the migration should fail loudly in environments where pgvector is expected, but CI may use a separate test path with mock/vector-free tests.

### 2. Update `clinic_knowledge_base`

Add these columns if not already present:

```sql
embedding vector(768),
embedding_model text,
embedding_dimensions integer,
embedding_status text NOT NULL DEFAULT 'pending',
embedding_generated_at timestamptz,
embedding_error text,
embedding_source_hash text,
search_text text,
last_embedding_job_id uuid,
```

Recommended `embedding_status` values:

```text
pending
generated
failed
stale
not_required
```

### 3. Add check constraints

Add constraints equivalent to:

```text
embedding_status IN ('pending', 'generated', 'failed', 'stale', 'not_required')
if embedding_status = generated, embedding_generated_at should be present
if embedding is present, embedding_model should be present
```

Use DB check constraints where practical, otherwise enforce in service layer.

### 4. Add indexes

Required base indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_clinic_kb_clinic_status
ON clinic_knowledge_base (clinic_id, status);

CREATE INDEX IF NOT EXISTS idx_clinic_kb_embedding_status
ON clinic_knowledge_base (clinic_id, embedding_status);

CREATE INDEX IF NOT EXISTS idx_clinic_kb_category
ON clinic_knowledge_base (clinic_id, category);
```

Vector index:

Prefer HNSW if the provider supports it:

```sql
CREATE INDEX IF NOT EXISTS idx_clinic_kb_embedding_hnsw
ON clinic_knowledge_base
USING hnsw (embedding vector_cosine_ops)
WHERE status = 'approved' AND embedding_status = 'generated';
```

If HNSW is not available or not suitable, use IVFFlat after enough data exists:

```sql
CREATE INDEX IF NOT EXISTS idx_clinic_kb_embedding_ivfflat
ON clinic_knowledge_base
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100)
WHERE status = 'approved' AND embedding_status = 'generated';
```

Implementation note:

```text
For very small data sets, sequential vector scan is acceptable during QA.
Do not over-optimize until real clinic Q&A volume grows.
```

---

## Embedding input text

Create one normalized searchable text per knowledge row.

Recommended format:

```text
Category: {category}
Question: {question}
Alternative phrases: {alternative_phrases joined}
Answer: {answer}
```

Store this in:

```text
clinic_knowledge_base.search_text
```

Rules:

1. Trim whitespace.
2. Normalize repeated spaces.
3. Keep Tamil/Tanglish/English text as-is.
4. Do not remove clinically meaningful words.
5. Do not include internal admin notes unless the clinic approved them for patient-facing use.
6. Do not include another clinic's data.

---

## Embedding generation lifecycle

### On manual Q&A creation

If row is created as `pending_review`:

```text
Do not generate runtime embedding immediately.
Set embedding_status = pending or not_required.
```

### On Q&A approval

When admin approves a knowledge row:

```text
1. status becomes approved.
2. search_text is generated/updated.
3. embedding_status becomes pending.
4. enqueue knowledge_embedding_generate job.
```

### On approved Q&A edit

When an approved row changes question/answer/phrases/category:

```text
1. mark embedding_status = stale.
2. update search_text.
3. enqueue knowledge_embedding_generate job.
4. old answer version should remain audit/history if versioning exists.
```

### On Q&A disable/archive

When row is disabled/archived:

```text
Do not delete embedding immediately.
Runtime search filters by status, so disabled rows are not used.
Optional cleanup can null embedding later.
```

---

## Background job: knowledge embedding generation

Add queue job type:

```text
knowledge.embedding.generate
```

Payload:

```json
{
  "clinic_id": "uuid",
  "knowledge_id": "uuid",
  "requested_by_user_id": "uuid|null",
  "reason": "approved|edited|bulk_regenerate|manual_retry"
}
```

Worker behavior:

```text
1. Load knowledge row by clinic_id + knowledge_id.
2. If row is not approved, mark embedding_status = not_required or leave pending and exit safely.
3. Build search_text.
4. Compute source hash from search_text + embedding_model.
5. If existing embedding_source_hash matches and status generated, skip.
6. Call EmbeddingProvider.embed(search_text).
7. Validate vector dimension equals EMBEDDING_DIMENSIONS.
8. Store embedding, model, dimensions, generated_at, source_hash, status generated.
9. On failure, set embedding_status = failed and embedding_error.
10. Write audit log: knowledge_embedding_generated or knowledge_embedding_failed.
```

Retries:

```text
max_attempts = 3
backoff = exponential
failure does not block admin UI
runtime falls back to text search/no-answer
```

---

## EmbeddingProvider interface

Create or update:

```ts
export type EmbeddingInput = {
  text: string;
  clinicId?: string;
  knowledgeId?: string;
};

export type EmbeddingResult = {
  vector: number[];
  model: string;
  dimensions: number;
};

export interface EmbeddingProvider {
  embed(input: EmbeddingInput): Promise<EmbeddingResult>;
}
```

Implement:

```text
MockEmbeddingProvider
Real provider adapter stub/implementation based on configured provider
```

Mock behavior:

```text
Deterministic vector for same input.
No external API call.
Useful for unit tests.
```

Real adapter behavior:

```text
Timeout protected.
Retries should be owned by queue job, not infinite inside provider.
Never log full patient or clinic private text in provider error logs.
```

---

## KnowledgeSearchTool interface

Create or update:

```ts
export type KnowledgeSearchInput = {
  clinicId: string;
  query: string;
  languageCode?: string | null;
  categoryHint?: string | null;
  limit?: number;
};

export type KnowledgeSearchResult = {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  sourceFile: string | null;
  sourcePage: number | null;
  score: number;
  searchProvider: 'text' | 'pgvector' | 'hybrid';
  embeddingModel?: string | null;
};

export interface KnowledgeSearchTool {
  search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]>;
}
```

Implement:

```text
SimpleTextKnowledgeSearchTool
PgVectorKnowledgeSearchTool
HybridKnowledgeSearchTool
```

---

## PgVector search behavior

Runtime query flow:

```text
1. Receive patient question.
2. Confirm intent is knowledge-like, not fee/timing/location/doctor availability/emergency/medical advice.
3. Generate query embedding using EmbeddingProvider.
4. Query only current clinic's approved rows with generated embeddings.
5. Apply categoryHint if available as score boost/filter, not as unsafe hard-only filter unless confidence is high.
6. Return top N matches.
7. If best score >= threshold, answer with approved answer.
8. If below threshold, return knowledge.no_answer.
```

Query concept using cosine distance:

```sql
SELECT
  id,
  question,
  answer,
  category,
  source_file,
  source_page,
  embedding_model,
  1 - (embedding <=> $query_embedding) AS score
FROM clinic_knowledge_base
WHERE clinic_id = $clinic_id
  AND status = 'approved'
  AND embedding_status = 'generated'
  AND embedding IS NOT NULL
ORDER BY embedding <=> $query_embedding
LIMIT $limit;
```

Important:

```text
Never omit clinic_id filter.
Never omit status = approved filter.
Never use pending_review rows.
```

---

## Hybrid search behavior

Hybrid is recommended for production v1.

Flow:

```text
1. Run pgvector search.
2. Run simple text search.
3. Merge/deduplicate results.
4. Prefer high-confidence exact/phrase match when obvious.
5. Prefer vector match for semantic variants.
6. If neither reaches threshold, no-answer fallback.
```

Scoring guidance:

```text
Exact question/phrase match can override vector if strong.
Vector score >= KNOWLEDGE_VECTOR_MIN_SCORE is acceptable.
Text score >= text threshold is acceptable.
Category hint can add small boost.
Do not let weak vector match answer medical/fee/timing questions.
```

---

## Knowledge answer response behavior

If answer found:

```text
Return approved answer through knowledge.answer template.
Do not add unapproved details.
Do not cite internal score/source to patient.
```

If no answer:

Tanglish:

```text
Indha detail clinic staff confirm pannuvanga.
```

English:

```text
Clinic staff will confirm this.
```

If knowledge question is asked inside active booking flow:

```text
answer approved knowledge or no-answer fallback
then resume current booking prompt
current_flow/current_state must remain unchanged
```

---

## Audit events

Add audit events:

```text
knowledge_embedding_job_queued
knowledge_embedding_generated
knowledge_embedding_failed
knowledge_vector_search_used
knowledge_vector_search_no_answer
knowledge_search_fallback_to_text
knowledge_answer_used
```

Do not expose internal audit details to patient.

---

## Admin/maintenance APIs

Add admin-only/internal APIs as needed:

```http
POST /v1/knowledge/{knowledgeId}/embedding/retry
POST /v1/knowledge/embeddings/regenerate
GET /v1/knowledge/embedding-status
```

Rules:

```text
Only clinic_admin or platform_admin can retry embeddings.
Bulk regenerate must be rate-limited and queued.
Do not block UI while embeddings generate.
```

---

## Application UI impact

Knowledge Base UI should show:

```text
embedding_status
last generated time
retry embedding button for failed rows
bulk regenerate embeddings button for admin/platform if needed
```

Do not show vector score to normal clinic users during patient conversation.

Internal/debug screen may show vector score later.

---

## Acceptance criteria

A09 is complete when:

```text
[ ] pgvector extension migration exists.
[ ] clinic_knowledge_base has embedding fields.
[ ] EmbeddingProvider interface exists.
[ ] MockEmbeddingProvider works in local/CI.
[ ] knowledge.embedding.generate job exists.
[ ] Approved Q&A queues embedding generation.
[ ] Editing approved Q&A marks embedding stale and regenerates.
[ ] Pending/unapproved Q&A does not generate/use runtime answer.
[ ] PgVectorKnowledgeSearchTool searches only approved rows for same clinic.
[ ] HybridKnowledgeSearchTool exists or pgvector/text provider selection works.
[ ] Runtime answer uses approved answer only.
[ ] No-answer fallback works for low similarity.
[ ] Structured DB questions do not go to knowledge vector search.
[ ] Tenant isolation tests pass.
[ ] Audit logs are written for embedding/search use.
[ ] CI passes without real embedding provider key.
```

---

## Do not implement in this milestone

Do not implement:

```text
voice call handling
STT/TTS
free-form LLM answer generation
auto-translating unapproved knowledge
billing
full analytics dashboard
```

Do not change:

```text
booking/cancel/reschedule action rules
appointment DB write behavior
doctor fee/timing/location structured handlers
```

---

## Prompt for the coding agent

Paste this section into Cursor/Antigravity/Codex for A09:

```text
Implement A09_PGVECTOR_KNOWLEDGE_SEMANTIC_SEARCH.

Use the final Vaidya production design as source of truth. PostgreSQL is source of truth. LLM must not query DB or execute actions. Knowledge Base answers must only come from current clinic approved rows.

Goal:
Add pgvector-backed semantic search for clinic-approved Knowledge Base Q&A while preserving simple text search fallback and structured DB precedence.

Required implementation:
1. Add pgvector migration and embedding fields to clinic_knowledge_base.
2. Add embedding status fields: embedding_status, embedding_model, embedding_dimensions, embedding_generated_at, embedding_error, embedding_source_hash, search_text.
3. Add indexes for clinic/status/category/embedding status and vector search if supported.
4. Create EmbeddingProvider interface with MockEmbeddingProvider and real provider adapter stub/implementation behind env.
5. Add KnowledgeSearchTool implementations: SimpleTextKnowledgeSearchTool, PgVectorKnowledgeSearchTool, HybridKnowledgeSearchTool or provider factory.
6. Add knowledge.embedding.generate queue job that generates embeddings for approved Q&A rows.
7. When knowledge is approved, edited, or bulk regenerated, enqueue embedding job.
8. Runtime knowledge search must use only clinic_id + status=approved + embedding_status=generated rows.
9. If vector score is below threshold, use knowledge.no_answer fallback.
10. Structured handlers for fee/timing/location/doctor availability must not use vector search.
11. Add audit logs for embedding generation, embedding failure, vector search used, no-answer fallback.
12. Keep local/CI default as mock/text search; no real provider key required.

Edge cases:
- Pending_review Q&A must never be answered.
- Disabled/archived Q&A must never be answered.
- Clinic A must never use Clinic B's knowledge.
- Embedding failure must not break Q&A approval UI.
- Runtime should fall back safely if embedding provider fails.
- Low similarity must not hallucinate an answer.
- Medical advice and emergency questions must never be answered from knowledge search.
- If a knowledge side-question is asked inside booking, answer/fallback and resume booking state.

Tests required:
- Unit tests for embedding provider mock.
- Unit tests for search provider selection.
- Integration tests for approved vs pending vs disabled knowledge.
- Tenant isolation tests.
- Low-score no-answer fallback test.
- Structured DB precedence tests.
- Booking side-question resume tests.
- Embedding job success/failure/retry tests.

Do not implement voice, STT, TTS, billing, or free-form LLM answer generation in this milestone.
```
