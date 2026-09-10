import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  ADAPTER_TOKENS,
  apiErrorBodySchema,
  apiSuccessBodySchema,
  type LockService,
} from '@vaidya/shared';

import { sessionLockKey } from '../src/common/locks/in-memory-lock.service';

import { prepareTestDatabase } from './db-setup';
import { SEED } from './test-constants';
import { createTestApp } from './test-app';

describe('A00 conversation foundation', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let sessionId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/vaidya_test';
    delete process.env.DEBUG_API;
    await prepareTestDatabase();
    app = await createTestApp();
    sql = postgres(process.env.DATABASE_URL, { max: 1 });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (sql) {
      await sql.end({ timeout: 5 });
    }
  });

  it('1. creates conversation with valid clinic', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      payload: {
        clinic_id: SEED.CLINIC_ID,
        channel: 'web_demo',
        patient_phone: '+919111111111',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = apiSuccessBodySchema.parse(response.json());
    const session = (body.data as { session: Record<string, unknown> }).session;
    sessionId = session.id as string;

    expect(session.clinic_id).toBe(SEED.CLINIC_ID);
    expect(session.patient_phone).toBe('+919111111111');
    expect(session.language_code).toBe('ta_tanglish');
    expect(session.current_flow).toBe('none');
    expect(session.current_state).toBe('IDLE');

    const rows = await sql`
      SELECT clinic_id, patient_phone, language_code
      FROM conversation_sessions
      WHERE id = ${sessionId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.patient_phone).toBe('+919111111111');
  });

  it('2. rejects invalid clinic', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      payload: {
        clinic_id: '00000000-0000-0000-0000-000000009999',
        channel: 'web_demo',
        patient_phone: '+919111111112',
      },
    });

    expect(response.statusCode).toBe(404);
    const errorBody = apiErrorBodySchema.parse(response.json());
    expect(errorBody.error.code).toBe('CLINIC_NOT_FOUND');
  });

  it('3. send message inserts patient and assistant message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${sessionId}/messages`,
      payload: {
        message_text: 'Hello',
        idempotency_key: 'a00_msg_001',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = apiSuccessBodySchema.parse(response.json());
    const data = body.data as {
      patient_message: { sender: string; message_text: string };
      assistant_message: { sender: string; message_text: string; reply_template_key: string | null };
      session: { current_flow: string; current_state: string };
    };

    expect(data.patient_message.sender).toBe('patient');
    expect(data.patient_message.message_text).toBe('Hello');
    expect(data.assistant_message.sender).toBe('assistant');
    expect(data.assistant_message.reply_template_key).toBe('booking.greeting');
    expect(data.assistant_message.message_text).toContain('Vaidya');
    expect(data.session.current_flow).toBe('booking');
    expect(data.session.current_state).toBe('ASK_PROBLEM_OR_DOCTOR');

    const messages = await sql`
      SELECT sender, message_text, reply_template_key
      FROM conversation_messages
      WHERE session_id = ${sessionId}
      ORDER BY created_at
    `;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.sender).toBe('patient');
    expect(messages[1]?.sender).toBe('assistant');
  });

  it('4. idempotency key prevents duplicate message processing', async () => {
    const payload = {
      message_text: 'Duplicate check',
      idempotency_key: 'a00_dup_001',
    };

    const first = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${sessionId}/messages`,
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstBody = apiSuccessBodySchema.parse(first.json());

    const second = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${sessionId}/messages`,
      payload,
    });
    expect(second.statusCode).toBe(201);
    const secondBody = apiSuccessBodySchema.parse(second.json());

    expect(secondBody.data).toEqual(firstBody.data);

    const messages = await sql`
      SELECT sender, message_text
      FROM conversation_messages
      WHERE session_id = ${sessionId} AND message_text = 'Duplicate check'
      ORDER BY created_at
    `;
    expect(messages).toHaveLength(1);
  });

  it('5. GET /conversations/{id} returns messages in order', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${sessionId}`,
    });

    expect(response.statusCode).toBe(200);
    const body = apiSuccessBodySchema.parse(response.json());
    const data = body.data as {
      messages: Array<{ sender: string; created_at: string }>;
    };

    expect(data.messages.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < data.messages.length; index += 1) {
      const previous = new Date(data.messages[index - 1]!.created_at).getTime();
      const current = new Date(data.messages[index]!.created_at).getTime();
      expect(current).toBeGreaterThanOrEqual(previous);
    }
  });

  it('6. session lock prevents concurrent updates to same session', async () => {
    const lockService = app.get<LockService>(ADAPTER_TOKENS.LockService);
    await lockService.acquire(sessionLockKey(sessionId), 30_000);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${sessionId}/messages`,
      payload: {
        message_text: 'Should fail while locked',
        idempotency_key: 'a00_lock_001',
      },
    });

    expect(response.statusCode).toBe(409);
    const errorBody = apiErrorBodySchema.parse(response.json());
    expect(errorBody.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(errorBody.error.details).toMatchObject({ reason: 'session_lock' });

    await lockService.release(sessionLockKey(sessionId));
  });

  it('7. different sessions can process in parallel', async () => {
    const createSession = async (phone: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/conversations',
        payload: {
          clinic_id: SEED.CLINIC_ID,
          channel: 'web_demo',
          patient_phone: phone,
        },
      });
      const body = apiSuccessBodySchema.parse(response.json());
      return (body.data as { session: { id: string } }).session.id;
    };

    const [parallelSessionA, parallelSessionB] = await Promise.all([
      createSession('+919111111201'),
      createSession('+919111111202'),
    ]);

    const [responseA, responseB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/conversations/${parallelSessionA}/messages`,
        payload: {
          message_text: 'Parallel A',
          idempotency_key: 'a00_parallel_a',
        },
      }),
      app.inject({
        method: 'POST',
        url: `/v1/conversations/${parallelSessionB}/messages`,
        payload: {
          message_text: 'Parallel B',
          idempotency_key: 'a00_parallel_b',
        },
      }),
    ]);

    expect(responseA.statusCode).toBe(201);
    expect(responseB.statusCode).toBe(201);
  });

  it('8. DEBUG_API=false hides debug', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${sessionId}/messages`,
      payload: {
        message_text: 'No debug please',
        idempotency_key: 'a00_debug_off',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = apiSuccessBodySchema.parse(response.json());
    const assistantMessage = (body.data as { assistant_message: Record<string, unknown> })
      .assistant_message;
    expect(assistantMessage.debug_json).toBeUndefined();
  });

  it('9. language switch message updates session language', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${sessionId}/messages`,
      payload: {
        message_text: 'English please',
        idempotency_key: 'a00_lang_switch',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = apiSuccessBodySchema.parse(response.json());
    const data = body.data as {
      session: { language_code: string };
      assistant_message: { intent: string | null; message_text: string };
    };

    expect(data.session.language_code).toBe('english');
    expect(data.assistant_message.intent).toBe('language_switch');
    expect(data.assistant_message.message_text).toContain('Hello');
  });

  it('10. missing session returns 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/conversations/00000000-0000-0000-0000-000000009999',
    });

    expect(response.statusCode).toBe(404);
    const errorBody = apiErrorBodySchema.parse(response.json());
    expect(errorBody.error.code).toBe('NOT_FOUND');
  });

  it('rejects missing message_text with VALIDATION_ERROR', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${sessionId}/messages`,
      payload: {
        idempotency_key: 'a00_missing_text',
      },
    });

    expect(response.statusCode).toBe(400);
    const errorBody = apiErrorBodySchema.parse(response.json());
    expect(errorBody.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('InMemoryLockService', () => {
  it('expires locks after ttl', async () => {
    const { InMemoryLockService } = await import('../src/common/locks/in-memory-lock.service');
    const lockService = new InMemoryLockService();

    expect(await lockService.acquire('test-key', 20)).toBe(true);
    expect(await lockService.acquire('test-key', 20)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await lockService.acquire('test-key', 20)).toBe(true);
    await lockService.release('test-key');
  });
});
