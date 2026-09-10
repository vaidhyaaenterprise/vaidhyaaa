# A09 Tests - pgvector Knowledge Semantic Search

## Purpose

Verify pgvector semantic search for Vaidya Knowledge Base is safe, clinic-scoped, approved-only, production-ready, and does not break structured handlers or active conversation flows.

Run these tests after implementing:

```text
A09_PGVECTOR_KNOWLEDGE_SEMANTIC_SEARCH
```

---

## Pre-test setup

Required local state:

```text
PostgreSQL running
Migrations applied
Seed clinic exists
Knowledge Base APIs/DB available
Queue foundation available or inline queue mode configured
```

Recommended env for local/CI:

```env
KNOWLEDGE_SEARCH_PROVIDER=hybrid
EMBEDDING_PROVIDER=mock
EMBEDDING_MODEL=mock-embedding-v1
EMBEDDING_DIMENSIONS=768
KNOWLEDGE_VECTOR_MIN_SCORE=0.70
QUEUE_MODE=inline
```

Run baseline:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter api test
```

---

## 1. Migration verification

### Check extension

```sql
SELECT extname
FROM pg_extension
WHERE extname = 'vector';
```

Expected:

```text
vector extension exists if pgvector is enabled for this environment.
```

### Check columns

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'clinic_knowledge_base'
ORDER BY ordinal_position;
```

Expected columns include:

```text
embedding
embedding_model
embedding_dimensions
embedding_status
embedding_generated_at
embedding_error
embedding_source_hash
search_text
last_embedding_job_id
```

### Check indexes

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'clinic_knowledge_base'
ORDER BY indexname;
```

Expected:

```text
clinic/status index
embedding_status index
category index
vector index if environment supports it
```

---

## 2. Approved Q&A queues embedding generation

### Steps

Create or update a knowledge row:

```text
question = Scan-ku fasting venuma?
answer = Abdomen scan requires fasting. Other scans depend on scan type. Clinic staff will confirm.
status = pending_review
```

Verify:

```sql
SELECT status, embedding_status, embedding IS NOT NULL AS has_embedding
FROM clinic_knowledge_base
WHERE question ILIKE '%fasting%';
```

Expected before approval:

```text
status = pending_review
embedding should not be used at runtime
embedding_status may be pending/not_required
```

Approve it using API or DB/service.

Expected after approval/job:

```sql
SELECT status, embedding_status, embedding_model, embedding_generated_at, search_text
FROM clinic_knowledge_base
WHERE question ILIKE '%fasting%';
```

Expected:

```text
status = approved
embedding_status = generated
embedding_model is set
embedding_generated_at is not null
search_text contains question and answer text
```

---

## 3. Pending Q&A must not be answered

Create pending row:

```text
question = Blood test-ku fasting venuma?
answer = Blood test fasting depends on test type.
status = pending_review
```

Ask:

```bash
curl -s -X POST http://localhost:3000/v1/conversations/<SESSION_ID>/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "message_text": "Blood test-ku fasting venuma?",
    "idempotency_key": "a09_pending_kb_001"
  }' | jq
```

Expected:

```text
Reply = Clinic staff will confirm this / Indha detail clinic staff confirm pannuvanga.
Must not return the pending answer.
```

DB check:

```sql
SELECT reply_template_key, intent
FROM conversation_messages
WHERE session_id = '<SESSION_ID>'
ORDER BY created_at DESC
LIMIT 1;
```

Expected:

```text
knowledge.no_answer or equivalent
```

---

## 4. Approved semantic match works

Approved row:

```text
Question: Scan-ku fasting venuma?
Alternative phrases: scan-ku sapdalaama, empty stomach, fasting for scan
Answer: Abdomen scan requires fasting. Other scans depend on scan type. Clinic staff will confirm.
status = approved
embedding_status = generated
```

Ask semantically similar wording:

```text
Scan-ku sapdalaama?
```

Expected:

```text
Approved scan fasting answer returned.
No hallucinated extra instruction.
```

Also test:

```text
Empty stomach-a varanuma scan-ku?
Before scan food sapdalaama?
```

Expected:

```text
Same approved answer if score >= threshold.
```

---

## 5. Low similarity falls back safely

Ask:

```text
MRI contrast injection side effects enna?
```

Assume no approved answer exists for this exact topic.

Expected:

```text
Clinic staff will confirm this.
```

Not acceptable:

```text
Any invented MRI/contrast medical instruction.
```

---

## 6. Tenant isolation

Setup:

Clinic A = Sri Murugan Clinic
Clinic B = Smile Dental Clinic

Clinic B has approved row:

```text
question = Tooth extraction-ku fasting venuma?
answer = Tooth extraction fasting instructions approved for dental clinic.
status = approved
embedding_status = generated
```

Clinic A does not have that row.

Ask in Clinic A session:

```text
Tooth extraction-ku fasting venuma?
```

Expected:

```text
Clinic staff will confirm this.
```

Must not use Clinic B answer.

SQL check:

```sql
SELECT clinic_id, question, status
FROM clinic_knowledge_base
WHERE question ILIKE '%Tooth extraction%';
```

Verify answer came only from current clinic if answered.

---

## 7. Disabled/archived answer is never used

Create approved generated row, then disable it:

```text
status = disabled or archived
```

Ask matching question.

Expected:

```text
No-answer fallback.
```

DB audit should not show `knowledge_answer_used` for disabled row.

---

## 8. Structured DB precedence

These must not use vector KB even if similar Q&A exists.

### Fee

Ask:

```text
Dr Priya fees evlo?
```

Expected:

```text
Answer from doctor_fees / structured service fee.
No vector search answer.
```

### Timing

Ask:

```text
Sunday open-a?
```

Expected:

```text
Answer from clinic_hours/holidays.
No KB answer unless explicit approved FAQ is only extra info and structured data missing.
```

### Availability

Ask:

```text
Dr Priya inniku irukkangala?
```

Expected:

```text
Answer from appointment_slots / doctor_schedules.
```

### Location

Ask:

```text
Clinic enga irukku?
```

Expected:

```text
Answer from clinics address/location table.
```

---

## 9. Emergency and medical advice override knowledge search

Ask:

```text
Chest pain irukku
```

Expected:

```text
Emergency response, 108 instruction, emergency_incident created.
No KB vector search answer.
```

Ask:

```text
Fever-ku enna tablet edukkanum?
```

Expected:

```text
Medical advice refusal.
No KB vector answer.
```

---

## 10. Knowledge side-question inside booking resumes booking

Create new session.

Send:

```text
Naalaikku evening appointment venum
```

Expected state:

```text
booking / ASK_PROBLEM_OR_DOCTOR
```

Then send:

```text
Parking irukka?
```

Expected:

```text
Approved parking answer or no-answer fallback.
Then resume booking prompt.
current_flow remains booking.
current_state remains ASK_PROBLEM_OR_DOCTOR.
```

DB check:

```sql
SELECT current_flow, current_state, collected_json
FROM conversation_sessions
WHERE id = '<SESSION_ID>';
```

Expected:

```text
current_flow = booking
state not reset to IDLE
```

---

## 11. Knowledge side-question in ASK_DATE resumes date prompt

Reach booking state where doctor/service known and current_state = ASK_DATE.

Ask:

```text
Scan-ku fasting venuma?
```

Expected:

```text
Approved scan answer or no-answer fallback.
Then ask date again.
current_state remains ASK_DATE.
```

---

## 12. Embedding job failure does not break runtime

Force mock/real provider to fail for one row.

Expected DB:

```text
embedding_status = failed
embedding_error is set
```

Runtime behavior:

```text
If text search finds strong approved match and hybrid mode allows fallback, answer approved answer.
Otherwise no-answer fallback.
API must not crash.
```

Audit:

```text
knowledge_embedding_failed exists
```

---

## 13. Editing approved Q&A marks embedding stale and regenerates

Steps:

1. Approve Q&A and generate embedding.
2. Edit answer text.
3. Verify `embedding_status = stale` or `pending`.
4. Run job.
5. Verify `embedding_status = generated` and `embedding_source_hash` changed.

SQL:

```sql
SELECT embedding_status, embedding_source_hash, embedding_generated_at
FROM clinic_knowledge_base
WHERE id = '<KNOWLEDGE_ID>';
```

Expected:

```text
embedding regenerated after edit.
```

---

## 14. Bulk regenerate embeddings

Call internal/admin API:

```bash
curl -s -X POST http://localhost:3000/v1/knowledge/embeddings/regenerate \
  -H 'Content-Type: application/json' \
  -d '{
    "clinic_id": "<CLINIC_ID>",
    "only_status": "approved"
  }' | jq
```

Expected:

```text
Jobs queued for approved rows only.
Pending/disabled rows skipped.
API returns queued count.
```

---

## 15. Provider selection tests

Run tests with:

```env
KNOWLEDGE_SEARCH_PROVIDER=text
EMBEDDING_PROVIDER=mock
```

Expected:

```text
Simple text search used.
No pgvector query required.
```

Run with:

```env
KNOWLEDGE_SEARCH_PROVIDER=pgvector
EMBEDDING_PROVIDER=mock
```

Expected:

```text
PgVectorKnowledgeSearchTool used.
```

Run with:

```env
KNOWLEDGE_SEARCH_PROVIDER=hybrid
EMBEDDING_PROVIDER=mock
```

Expected:

```text
Hybrid search used.
```

---

## 16. Audit log verification

For answered knowledge:

```sql
SELECT event_type, event_data_json
FROM audit_logs
WHERE event_type IN (
  'knowledge_answer_used',
  'knowledge_vector_search_used',
  'knowledge_vector_search_no_answer',
  'knowledge_search_fallback_to_text'
)
ORDER BY created_at DESC
LIMIT 20;
```

Expected:

```text
Audit logs include knowledge_id, clinic_id, search_provider, score, category.
Patient-facing reply must not expose score/vector details.
```

---

## 17. API smoke tests

### Retry failed embedding

```bash
curl -s -X POST http://localhost:3000/v1/knowledge/<KNOWLEDGE_ID>/embedding/retry | jq
```

Expected:

```text
embedding job queued
requires clinic_admin/platform_admin
```

### Get embedding status

```bash
curl -s http://localhost:3000/v1/knowledge/embedding-status | jq
```

Expected includes:

```text
approved_total
generated_count
pending_count
failed_count
stale_count
```

---

## 18. Performance sanity check

Seed at least:

```text
100 approved knowledge rows in one clinic
100 approved knowledge rows in another clinic
```

Run 20 searches.

Expected:

```text
No cross-clinic leakage.
Search latency acceptable for text-core QA.
No API timeouts.
```

Do not over-optimize until real production data exists.

---

## 19. CI expectations

CI should pass without real embedding API keys.

Required:

```text
MockEmbeddingProvider is deterministic.
pgvector-dependent tests are either supported by CI Postgres or separated behind integration test flag.
Unit tests do not require external network.
```

Commands:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter api test
```

Expected:

```text
All pass.
```

---

## 20. Final A09 pass checklist

A09 passes when:

```text
[ ] Migration adds pgvector and embedding fields.
[ ] Approved knowledge generates embeddings.
[ ] Pending knowledge is never answered.
[ ] Disabled/archived knowledge is never answered.
[ ] Semantic wording retrieves correct approved answer.
[ ] Low similarity returns no-answer fallback.
[ ] Tenant isolation is guaranteed.
[ ] Structured DB precedence is preserved.
[ ] Emergency/medical advice override vector search.
[ ] Knowledge side-question during booking resumes booking.
[ ] Embedding failure does not crash runtime.
[ ] Editing approved Q&A regenerates embeddings.
[ ] Bulk regenerate works safely.
[ ] Provider selection works through env.
[ ] Audit logs are created.
[ ] CI does not require real embedding provider key.
```
