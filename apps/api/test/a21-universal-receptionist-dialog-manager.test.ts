import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { apiSuccessBodySchema } from '@vaidya/shared';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';

async function createConversation(app: NestFastifyApplication, phone: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/conversations',
    payload: {
      clinic_id: SEED.CLINIC_ID,
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
      status: string;
    };
    assistant_message: {
      reply_template_key: string | null;
      message_text: string;
      debug_json?: Record<string, unknown> | null;
    };
  };
}

async function startBookingToProblemStep(app: NestFastifyApplication, phone: string) {
  const sessionId = await createConversation(app, phone);
  const greeting = await sendMessage(app, sessionId, 'Appointment venum', `${phone}_greet`);
  expect(greeting.assistant_message.reply_template_key).toBe('booking.ask_problem_or_doctor');
  return sessionId;
}

describe('A21 universal receptionist dialog manager', () => {
  let app: NestFastifyApplication;
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/vaidya_test';
    process.env.QUEUE_MODE = 'inline';
    delete process.env.REDIS_URL;

    await prepareTestDatabase();
    app = await createTestApp();
    sql = postgres(process.env.DATABASE_URL, { max: 5 });
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  it('A1 thanks after booking.created_pending acknowledges without duplicate appointment', async () => {
    const sessionId = await createConversation(app, '+919876543210a1');
    await sql`
      UPDATE conversation_sessions
      SET current_flow = 'booking', current_state = 'DONE', status = 'active',
          collected_json = ${sql.json({ awaiting_terminal_ack: 'booking_complete' })}
      WHERE id = ${sessionId}
    `;
    await sql`
      INSERT INTO conversation_messages (
        clinic_id, session_id, sender, message_text, reply_template_key,
        flow_before, state_before, flow_after, state_after
      ) VALUES (
        ${SEED.CLINIC_ID}, ${sessionId}, 'assistant', 'Appointment request create panniten.',
        'booking.created_pending', 'booking', 'CONFIRM_DETAILS', 'booking', 'DONE'
      )
    `;
    const thanks = await sendMessage(app, sessionId, 'thanks', 'a21_a1_thanks');
    expect(thanks.assistant_message.reply_template_key).toBe('ack.thanks_offer_help');
    expect(thanks.session.current_flow).toBe('none');
    expect(thanks.session.current_state).toBe('IDLE');

    const appointments = await sql<{ id: string }[]>`
      SELECT id FROM appointment_requests WHERE source_session_id = ${sessionId}
    `;
    expect(appointments).toHaveLength(0);
  });

  it('A4 vague information request during booking asks which detail', async () => {
    const sessionId = await startBookingToProblemStep(app, '+919111111101');
    const step = await sendMessage(app, sessionId, 'I need some details', 'a21_a4');
    expect(['clarify.which_detail', 'clarify.which_detail_resume']).toContain(
      step.assistant_message.reply_template_key,
    );
    expect(step.session.current_flow).toBe('booking');
    expect(step.session.current_state).toBe('ASK_PROBLEM_OR_DOCTOR');
    expect(step.assistant_message.message_text.toLowerCase()).toContain('detail');
  });

  it('A7 clinic timings side question during booking resumes booking', async () => {
    const sessionId = await startBookingToProblemStep(app, '+919111111102');
    const step = await sendMessage(app, sessionId, 'clinic timings sollunga', 'a21_a7');
    expect(step.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step.session.current_flow).toBe('booking');
    expect(step.session.current_state).toBe('ASK_PROBLEM_OR_DOCTOR');
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/timing|open|mon|9/);
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/doctor|problem|appointment/);
  });

  it('A10 fever continues booking flow', async () => {
    const sessionId = await startBookingToProblemStep(app, '+919111111103');
    const step = await sendMessage(app, sessionId, 'Fever', 'a21_a10');
    expect(step.session.current_flow).toBe('booking');
    expect(step.session.collected_json.reason_for_visit).toBeTruthy();
    expect(step.assistant_message.reply_template_key).not.toBe('booking.ask_problem_or_doctor');
  });

  it('A13 out of scope during booking redirects and keeps booking state', async () => {
    const sessionId = await startBookingToProblemStep(app, '+919111111104');
    await sendMessage(app, sessionId, 'Fever', 'a21_a13_1');
    const step = await sendMessage(app, sessionId, 'cricket score enna?', 'a21_a13_2');
    expect(step.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step.session.current_flow).toBe('booking');
    expect(step.assistant_message.message_text.toLowerCase()).toContain('help');
  });

  it('A15 medical advice refusal does not answer medicine', async () => {
    const sessionId = await startBookingToProblemStep(app, '+919111111105');
    const step = await sendMessage(app, sessionId, 'Fever-ku enna tablet?', 'a21_a15');
    expect(step.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/medicine|advice|doctor/);
    expect(step.assistant_message.message_text.toLowerCase()).not.toMatch(/paracetamol|dolo|tablet name/);
  });

  it('A16 emergency ends booking and creates incident', async () => {
    const sessionId = await startBookingToProblemStep(app, '+919111111106');
    const step = await sendMessage(app, sessionId, 'Chest pain irukku appointment venum', 'a21_a16');
    expect(step.assistant_message.reply_template_key).toMatch(/safety\.emergency/);
    const incidents = await sql<{ id: string }[]>`
      SELECT id FROM emergency_incidents WHERE source_session_id = ${sessionId}
    `;
    expect(incidents.length).toBeGreaterThan(0);
  });

  it('A3 okay after unknown.clarify offers help safely', async () => {
    const sessionId = await createConversation(app, '+919111111107');
    const unknown = await sendMessage(app, sessionId, 'xyz random gibberish qwerty', 'a21_a3_1');
    expect(unknown.assistant_message.reply_template_key).toBe('unknown.clarify');
    const okay = await sendMessage(app, sessionId, 'okay', 'a21_a3_2');
    expect(['ack.okay_offer_help', 'unknown.help_options']).toContain(
      okay.assistant_message.reply_template_key,
    );
    expect(okay.assistant_message.reply_template_key).not.toMatch(/emergency/);
    expect(okay.session.current_flow).not.toBe('cancel');
  });
});
