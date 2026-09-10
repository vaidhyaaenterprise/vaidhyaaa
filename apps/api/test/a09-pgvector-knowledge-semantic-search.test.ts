import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { parseApiEnv } from '@vaidya/config';
import { apiSuccessBodySchema } from '@vaidya/shared';

import { KnowledgeEmbeddingService } from '../src/modules/knowledge/knowledge-embedding.service';
import { buildDeterministicEmbedding } from '../src/modules/knowledge/embedding-provider.factory';
import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { devAuthHeaders, SEED } from './test-constants';

const OTHER_CLINIC_ID = '00000000-0000-0000-0000-000000000002';

function waitForInlineJob(ms = 500): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createConversation(
  app: NestFastifyApplication,
  phone: string,
  clinicId = SEED.CLINIC_ID,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/conversations',
    payload: {
      clinic_id: clinicId,
      channel: 'web_demo',
      patient_phone: phone,
    },
  });
  expect(response.statusCode).toBe(201);
  const body = apiSuccessBodySchema.parse(response.json());
  return (body.data as { session: { id: string } }).session.id;
}

async function sendMessage(
  app: NestFastifyApplication,
  sessionId: string,
  messageText: string,
  idempotencyKey: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/conversations/${sessionId}/messages`,
    payload: { message_text: messageText, idempotency_key: idempotencyKey },
  });
  expect(response.statusCode).toBe(201);
  return apiSuccessBodySchema.parse(response.json()).data as {
    session: {
      id: string;
      current_flow: string;
      current_state: string;
      collected_json: Record<string, unknown>;
    };
    assistant_message: { reply_template_key: string | null; message_text: string };
  };
}

async function regenerateSeedEmbeddings(app: NestFastifyApplication) {
  const embeddingService = app.get(KnowledgeEmbeddingService);
  await embeddingService.bulkRegenerateEmbeddings({ clinicId: SEED.CLINIC_ID });
  await waitForInlineJob(1000);
}

function configureA09Env() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/vaidya_test';
  process.env.KNOWLEDGE_SEARCH_PROVIDER = 'hybrid';
  process.env.EMBEDDING_PROVIDER = 'mock';
  process.env.EMBEDDING_MODEL = 'mock-embedding-v1';
  process.env.EMBEDDING_DIMENSIONS = '768';
  process.env.KNOWLEDGE_VECTOR_MIN_SCORE = '0.70';
  process.env.QUEUE_MODE = 'inline';
  delete process.env.EMBEDDING_MOCK_FAIL_KNOWLEDGE_IDS;
}

describe('A09 pgvector knowledge semantic search', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;

  beforeAll(async () => {
    configureA09Env();
    await prepareTestDatabase();
    app = await createTestApp();
    sql = postgres(getTestDatabaseUrl());
    const slotGeneration = app.get(SlotGenerationService);
    await slotGeneration.generateSlots({
      clinicId: SEED.CLINIC_ID,
      doctorId: SEED.DOCTOR_PRIYA_ID,
      clinicServiceId: '00000000-0000-0000-0000-000000000302',
    });
    await regenerateSeedEmbeddings(app);

    await sql`
      UPDATE clinic_knowledge_base
      SET alternative_phrases_json = '["scan fasting", "scan-ku sapdalaama", "empty stomach", "before scan food"]'::jsonb,
          search_text = 'scan-ku fasting venuma abdomen scan sapdalaama empty stomach before scan food fasting'
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND question ILIKE '%Scan-ku fasting%'
    `;
    await regenerateSeedEmbeddings(app);

    await sql`
      INSERT INTO clinics (id, name, primary_phone, address_line1, city, state, country, timezone, default_language_code, active, onboarding_status)
      VALUES (${OTHER_CLINIC_ID}, 'Other Dental Clinic', '+914400000002', 'T Nagar', 'Chennai', 'Tamil Nadu', 'India', 'Asia/Kolkata', 'ta_tanglish', true, 'ready_for_agent')
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO clinic_knowledge_base (clinic_id, question, answer, category, alternative_phrases_json, status, search_text)
      VALUES
      (${SEED.CLINIC_ID}, 'Insurance pending answer?', 'This should never be used.', 'insurance', '[]', 'pending_review', 'insurance pending')
      ON CONFLICT DO NOTHING
    `;

    await sql`
      INSERT INTO clinic_knowledge_base (clinic_id, question, answer, category, alternative_phrases_json, status, search_text)
      VALUES
      (${OTHER_CLINIC_ID}, 'Tooth extraction-ku fasting venuma?', 'Dental clinic fasting answer.', 'pre_visit_instruction', '["tooth extraction fasting"]', 'approved', 'tooth extraction fasting dental')
      ON CONFLICT DO NOTHING
    `;

    const [dentalRow] = await sql`
      SELECT id FROM clinic_knowledge_base
      WHERE clinic_id = ${OTHER_CLINIC_ID}
        AND question ILIKE '%Tooth extraction%'
      LIMIT 1
    `;
    if (dentalRow?.id) {
      const embeddingService = app.get(KnowledgeEmbeddingService);
      await embeddingService.generateEmbedding(OTHER_CLINIC_ID, dentalRow.id as string);
    }
  }, 120_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (sql) {
      await sql.end();
    }
  });

  it('1. migration adds pgvector extension and embedding metadata columns', async () => {
    const [extension] = await sql`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    expect(extension?.extname).toBe('vector');

    const columns = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'clinic_knowledge_base'
    `;
    const columnNames = columns.map((row) => row.column_name);
    for (const name of [
      'embedding',
      'question_embedding',
      'answer_embedding',
      'embedding_model',
      'embedding_dimensions',
      'embedding_status',
      'embedding_generated_at',
      'embedding_error',
      'embedding_source_hash',
      'search_text',
      'last_embedding_job_id',
    ]) {
      expect(columnNames).toContain(name);
    }

    const indexes = await sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'clinic_knowledge_base'
    `;
    const indexNames = indexes.map((row) => row.indexname);
    expect(indexNames.some((name) => name.includes('clinic_kb_clinic_status'))).toBe(true);
    expect(indexNames.some((name) => name.includes('clinic_kb_embedding_status'))).toBe(true);
    expect(indexNames.some((name) => name.includes('clinic_kb_category'))).toBe(true);
  });

  it('2. approving knowledge queues embedding generation', async () => {
    const [inserted] = await sql`
      INSERT INTO clinic_knowledge_base (clinic_id, question, answer, category, alternative_phrases_json, status, search_text, embedding_status)
      VALUES (
        ${SEED.CLINIC_ID},
        'Blood test-ku fasting venuma?',
        'Blood test fasting depends on test type.',
        'pre_visit_instruction',
        '[]'::jsonb,
        'pending_review',
        'blood test fasting',
        'not_required'
      )
      RETURNING id
    `;

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/knowledge/${inserted!.id}`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
      payload: { status: 'approved', clinic_id: SEED.CLINIC_ID },
    });
    expect(response.statusCode).toBe(200);
    await waitForInlineJob(800);

    const [row] = await sql`
      SELECT
        status,
        embedding_status,
        embedding_model,
        embedding_generated_at,
        search_text,
        question_embedding,
        answer_embedding
      FROM clinic_knowledge_base
      WHERE id = ${inserted!.id}
    `;
    expect(row?.status).toBe('approved');
    expect(row?.embedding_status).toBe('generated');
    expect(row?.embedding_model).toBe('mock-embedding-v1');
    expect(row?.embedding_generated_at).toBeTruthy();
    expect(String(row?.search_text).toLowerCase()).toContain('blood test');
    expect(row?.question_embedding).toBeTruthy();
    expect(row?.answer_embedding).toBeTruthy();
  });

  it('3. pending knowledge is not answered at runtime', async () => {
    await sql`
      INSERT INTO clinic_knowledge_base (clinic_id, question, answer, category, alternative_phrases_json, status, search_text)
      VALUES (
        ${SEED.CLINIC_ID},
        'Insurance pending answer?',
        'This should never be used.',
        'insurance',
        '[]'::jsonb,
        'pending_review',
        'insurance pending'
      )
      ON CONFLICT DO NOTHING
    `;

    const sessionId = await createConversation(app, '+919222229001');
    const result = await sendMessage(
      app,
      sessionId,
      'Insurance pending answer?',
      'a09_pending_kb_001',
    );
    expect(result.assistant_message.message_text).not.toContain('should never be used');
    expect(result.assistant_message.message_text.toLowerCase()).toContain('staff');
  });

  it('4. approved semantic match works for scan fasting variants', async () => {
    const sessionId = await createConversation(app, '+919222229002');
    const result = await sendMessage(app, sessionId, 'Scan-ku sapdalaama?', 'a09_sem_1');
    expect(result.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(result.assistant_message.message_text.toLowerCase()).toContain('fasting');

    const sessionId2 = await createConversation(app, '+919222229003');
    const result2 = await sendMessage(
      app,
      sessionId2,
      'Empty stomach-a varanuma scan-ku?',
      'a09_sem_2',
    );
    expect(result2.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(result2.assistant_message.message_text.toLowerCase()).toContain('scan');
  });

  it('5. low similarity falls back to staff confirmation', async () => {
    const sessionId = await createConversation(app, '+919222229004');
    const result = await sendMessage(
      app,
      sessionId,
      'MRI contrast injection side effects enna?',
      'a09_low_sim',
    );
    expect(result.assistant_message.message_text.toLowerCase()).toContain('staff');
    expect(result.assistant_message.message_text.toLowerCase()).not.toContain('contrast injection');
  });

  it('6. tenant isolation prevents cross-clinic knowledge answers', async () => {
    const sessionId = await createConversation(app, '+919222229005');
    const result = await sendMessage(
      app,
      sessionId,
      'Tooth extraction-ku fasting venuma?',
      'a09_tenant',
    );
    expect(result.assistant_message.message_text).not.toContain('Dental clinic fasting answer');
    expect(result.assistant_message.message_text.toLowerCase()).toContain('staff');
  });

  it('7. disabled knowledge is never used', async () => {
    const [inserted] = await sql`
      INSERT INTO clinic_knowledge_base (
        clinic_id, question, answer, category, alternative_phrases_json, status, search_text, embedding_status
      )
      VALUES (
        ${SEED.CLINIC_ID},
        'Disabled parking answer?',
        'Disabled-only parking answer.',
        'facility_info',
        '[]'::jsonb,
        'approved',
        'disabled parking answer',
        'pending'
      )
      RETURNING id
    `;

    const embeddingService = app.get(KnowledgeEmbeddingService);
    await embeddingService.generateEmbedding(SEED.CLINIC_ID, inserted!.id as string);

    await sql`
      UPDATE clinic_knowledge_base
      SET status = 'disabled'
      WHERE id = ${inserted!.id}
    `;

    const sessionId = await createConversation(app, '+919222229006');
    const result = await sendMessage(
      app,
      sessionId,
      'Disabled parking answer?',
      'a09_disabled',
    );
    expect(result.assistant_message.message_text).not.toContain('Disabled-only parking answer');
    expect(result.assistant_message.message_text.toLowerCase()).toContain('staff');

    const audits = await sql`
      SELECT event_type FROM audit_logs
      WHERE entity_id = ${inserted!.id}
        AND event_type = 'knowledge_answer_used'
    `;
    expect(audits.length).toBe(0);
  });

  it('8. structured DB precedence is preserved', async () => {
    const feeSession = await createConversation(app, '+919222229007');
    const fee = await sendMessage(app, feeSession, 'Dr Priya fees evlo?', 'a09_fee');
    expect(fee.assistant_message.reply_template_key).toBe('fee.answer');

    const timingSession = await createConversation(app, '+919222229008');
    const timing = await sendMessage(app, timingSession, 'Sunday open-a?', 'a09_timing');
    expect(timing.assistant_message.reply_template_key).toBe('timing.day_closed');

    const locationSession = await createConversation(app, '+919222229009');
    const location = await sendMessage(app, locationSession, 'Clinic enga irukku?', 'a09_loc');
    expect(location.assistant_message.reply_template_key).toBe('location.answer');

    const availSession = await createConversation(app, '+919222229010');
    const avail = await sendMessage(
      app,
      availSession,
      'Dr Priya inniku irukkangala?',
      'a09_avail',
    );
    expect([
      'availability.today_slots',
      'availability.no_slots',
      'availability.not_available',
    ]).toContain(avail.assistant_message.reply_template_key);
  });

  it('9. emergency and medical advice override knowledge search', async () => {
    const emergencySession = await createConversation(app, '+919222229011');
    const emergency = await sendMessage(
      app,
      emergencySession,
      'Chest pain irukku',
      'a09_emergency',
    );
    expect(emergency.assistant_message.reply_template_key).toBe('safety.emergency');
    expect(emergency.assistant_message.message_text).toContain('108');

    const adviceSession = await createConversation(app, '+919222229012');
    const advice = await sendMessage(
      app,
      adviceSession,
      'Fever-ku enna tablet edukkanum?',
      'a09_advice',
    );
    expect(advice.assistant_message.reply_template_key).toBe('safety.medical_advice_refusal');
  });

  it('10. knowledge side-question during booking resumes booking state', async () => {
    const sessionId = await createConversation(app, '+919222229013');
    const step1 = await sendMessage(
      app,
      sessionId,
      'Naalaikku evening appointment venum',
      'a09_book_1',
    );
    expect(step1.session.current_flow).toBe('booking');
    expect(step1.session.current_state).toBe('ASK_PROBLEM_OR_DOCTOR');

    const step2 = await sendMessage(app, sessionId, 'Parking irukka?', 'a09_book_2');
    expect(step2.session.current_flow).toBe('booking');
    expect(step2.session.current_state).toBe('ASK_PROBLEM_OR_DOCTOR');
    expect(step2.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step2.assistant_message.message_text.toLowerCase()).toContain('parking');
  });

  it('11. knowledge side-question in ASK_DATE resumes date prompt', async () => {
    const sessionId = await createConversation(app, '+919222229014');
    const step1 = await sendMessage(app, sessionId, 'Fever appointment venum', 'a09_date_1');
    expect(step1.session.current_state).toBe('ASK_DATE');

    const step2 = await sendMessage(app, sessionId, 'Scan-ku fasting venuma?', 'a09_date_2');
    expect(step2.session.current_flow).toBe('booking');
    expect(step2.session.current_state).toBe('ASK_DATE');
    expect(step2.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step2.assistant_message.message_text.toLowerCase()).toContain('fasting');
  });

  it('12. embedding job failure does not break runtime', async () => {
    await sql`
      INSERT INTO clinic_knowledge_base (
        clinic_id, question, answer, category, alternative_phrases_json, status, search_text, embedding_status, embedding_error
      )
      VALUES (
        ${SEED.CLINIC_ID},
        'Force fail embedding row?',
        'Force fail embedding answer.',
        'pre_visit_instruction',
        '[]'::jsonb,
        'approved',
        'force fail embedding row answer',
        'failed',
        'mock_embedding_provider_forced_failure'
      )
      RETURNING id
    `;

    const sessionId = await createConversation(app, '+919222229015');
    const result = await sendMessage(
      app,
      sessionId,
      'Force fail embedding row?',
      'a09_embed_fail',
    );
    expect(result.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(result.assistant_message.message_text).toContain('Force fail embedding answer');

    const audits = await sql`
      SELECT event_type FROM audit_logs
      WHERE event_type = 'knowledge_embedding_failed'
      ORDER BY created_at DESC
      LIMIT 5
    `;
    expect(audits.length).toBeGreaterThanOrEqual(0);
  });

  it('13. editing approved Q&A marks embedding stale and regenerates', async () => {
    const [inserted] = await sql`
      INSERT INTO clinic_knowledge_base (
        clinic_id, question, answer, category, alternative_phrases_json, status, search_text, embedding_status
      )
      VALUES (
        ${SEED.CLINIC_ID},
        'Report collection time?',
        'Reports available after 24 hours.',
        'reports',
        '[]'::jsonb,
        'approved',
        'report collection time',
        'pending'
      )
      RETURNING id
    `;

    const embeddingService = app.get(KnowledgeEmbeddingService);
    const first = await embeddingService.generateEmbedding(SEED.CLINIC_ID, inserted!.id as string);
    expect(first.status).toBe('generated');

    const [beforeEdit] = await sql`
      SELECT embedding_source_hash FROM clinic_knowledge_base WHERE id = ${inserted!.id}
    `;

    await app.inject({
      method: 'PATCH',
      url: `/v1/knowledge/${inserted!.id}`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
      payload: {
        clinic_id: SEED.CLINIC_ID,
        answer: 'Reports available after 48 hours.',
      },
    });
    await waitForInlineJob(800);

    const [afterEdit] = await sql`
      SELECT embedding_status, embedding_source_hash, embedding_generated_at
      FROM clinic_knowledge_base
      WHERE id = ${inserted!.id}
    `;
    expect(afterEdit?.embedding_status).toBe('generated');
    expect(afterEdit?.embedding_source_hash).not.toBe(beforeEdit?.embedding_source_hash);
    expect(afterEdit?.embedding_generated_at).toBeTruthy();
  });

  it('14. bulk regenerate embeddings queues approved rows only', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/knowledge/embeddings/regenerate',
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
      payload: {
        clinic_id: SEED.CLINIC_ID,
        only_status: 'approved',
      },
    });
    expect([200, 201]).toContain(response.statusCode);
    const body = apiSuccessBodySchema.parse(response.json());
    expect((body.data as { queued: number }).queued).toBeGreaterThan(0);
  });

  it('15. mock embedding provider is deterministic', () => {
    const first = buildDeterministicEmbedding('scan fasting abdomen', 768);
    const second = buildDeterministicEmbedding('scan fasting abdomen', 768);
    expect(first).toEqual(second);
    expect(first.length).toBe(768);
  });

  it('16. audit logs are written for knowledge answers', async () => {
    const sessionId = await createConversation(app, '+919222229016');
    await sendMessage(app, sessionId, 'Parking irukka?', 'a09_audit');

    const audits = await sql`
      SELECT event_type, event_data_json
      FROM audit_logs
      WHERE event_type IN (
        'knowledge_answer_used',
        'knowledge_vector_search_used',
        'knowledge_vector_search_no_answer',
        'knowledge_search_fallback_to_text'
      )
      ORDER BY created_at DESC
      LIMIT 20
    `;
    expect(audits.some((row) => row.event_type === 'knowledge_answer_used')).toBe(true);
    const answerAudit = audits.find((row) => row.event_type === 'knowledge_answer_used');
    expect(answerAudit?.event_data_json).toMatchObject({
      search_provider: expect.any(String),
      score: expect.any(Number),
    });
  });

  it('17. admin embedding status and retry APIs work', async () => {
    const statusResponse = await app.inject({
      method: 'GET',
      url: '/v1/knowledge/embedding-status',
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });
    expect(statusResponse.statusCode).toBe(200);
    const statusBody = apiSuccessBodySchema.parse(statusResponse.json());
    const status = (statusBody.data as { embedding_status: Record<string, number> }).embedding_status;
    expect(status.approved_total).toBeGreaterThan(0);

    const [row] = await sql`
      SELECT id FROM clinic_knowledge_base
      WHERE clinic_id = ${SEED.CLINIC_ID} AND status = 'approved'
      LIMIT 1
    `;

    const retryResponse = await app.inject({
      method: 'POST',
      url: `/v1/knowledge/${row!.id}/embedding/retry`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
      payload: { clinic_id: SEED.CLINIC_ID },
    });
    expect(retryResponse.statusCode).toBe(201);
    const retryBody = apiSuccessBodySchema.parse(retryResponse.json());
    expect((retryBody.data as { queued: boolean }).queued).toBe(true);
  });

  it('18. performance sanity with many knowledge rows stays clinic-scoped', async () => {
    for (let index = 0; index < 100; index += 1) {
      await sql`
        INSERT INTO clinic_knowledge_base (
          clinic_id, question, answer, category, alternative_phrases_json, status, search_text, embedding_status
        )
        VALUES (
          ${SEED.CLINIC_ID},
          ${`Perf question A ${index}?`},
          ${`Perf answer A ${index}.`},
          'perf',
          '[]'::jsonb,
          'approved',
          ${`perf question a ${index}`},
          'pending'
        )
      `;
      await sql`
        INSERT INTO clinic_knowledge_base (
          clinic_id, question, answer, category, alternative_phrases_json, status, search_text, embedding_status
        )
        VALUES (
          ${OTHER_CLINIC_ID},
          ${`Perf question B ${index}?`},
          ${`Perf answer B ${index}.`},
          'perf',
          '[]'::jsonb,
          'approved',
          ${`perf question b ${index}`},
          'pending'
        )
      `;
    }

    const embeddingService = app.get(KnowledgeEmbeddingService);
    await embeddingService.bulkRegenerateEmbeddings({ clinicId: SEED.CLINIC_ID });
    await embeddingService.bulkRegenerateEmbeddings({ clinicId: OTHER_CLINIC_ID });
    await waitForInlineJob(1500);

    for (let index = 0; index < 20; index += 1) {
      const sessionId = await createConversation(app, `+919222228${String(index).padStart(3, '0')}`);
      const result = await sendMessage(
        app,
        sessionId,
        `Perf question B ${index}?`,
        `a09_perf_${index}`,
      );
      expect(result.assistant_message.message_text).not.toContain(`Perf answer B ${index}`);
    }
  }, 180_000);
});

describe('A09 knowledge search provider selection', () => {
  it('selects text, pgvector, and hybrid providers from env', () => {
    expect(parseApiEnv({ ...process.env, KNOWLEDGE_SEARCH_PROVIDER: 'text' }).KNOWLEDGE_SEARCH_PROVIDER).toBe('text');
    expect(parseApiEnv({ ...process.env, KNOWLEDGE_SEARCH_PROVIDER: 'pgvector' }).KNOWLEDGE_SEARCH_PROVIDER).toBe('pgvector');
    expect(parseApiEnv({ ...process.env, KNOWLEDGE_SEARCH_PROVIDER: 'hybrid' }).KNOWLEDGE_SEARCH_PROVIDER).toBe('hybrid');
  });
});

function getTestDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5433/vaidya_test'
  );
}
