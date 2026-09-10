import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  ADAPTER_TOKENS,
  apiSuccessBodySchema,
  type IntentClassifierAdapter,
  type IntentClassifierResult,
} from '@vaidya/shared';

import { addDays, dayOfWeekMon1, formatDateInTimezone } from '@vaidya/db';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';
import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';

const TIMEZONE = 'Asia/Kolkata';

function tomorrowIso(): string {
  const today = formatDateInTimezone(new Date(), TIMEZONE);
  return addDays(today, 1, TIMEZONE);
}

function findNextBookableDate(minOffsetFromToday = 1): string {
  const today = formatDateInTimezone(new Date(), TIMEZONE);
  for (let offset = minOffsetFromToday; offset <= 14; offset += 1) {
    const candidate = addDays(today, offset, TIMEZONE);
    const dayOfWeek = dayOfWeekMon1(candidate, TIMEZONE);
    if (dayOfWeek >= 1 && dayOfWeek <= 6) {
      return candidate;
    }
  }
  throw new Error('No bookable weekday found in test horizon');
}

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
      current_flow: string;
      current_state: string;
      collected_json: Record<string, unknown>;
      status: string;
    };
    assistant_message: {
      reply_template_key: string | null;
      intent?: string | null;
      message_text?: string;
    };
  };
}

function sarvamLikeMisclassification(messageText: string): IntentClassifierResult {
  return {
    intent: 'greeting_smalltalk',
    confidence: 0.92,
    languageCode: 'ta_tanglish',
    entities: {
      patientName: null,
      doctorName: null,
      reasonForVisit: messageText.trim(),
      date: null,
      timePreference: null,
      visitType: null,
      dayName: null,
      feeCategory: null,
      topic: null,
      requestedLanguageCode: null,
    },
    safety: {
      isEmergency: false,
      isMedicalAdviceRequest: false,
      reason: null,
    },
    needsClarification: false,
  };
}

describe('A19 NLU normalization and prompt-aware routing', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/vaidya_test';
    process.env.QUEUE_MODE = 'inline';
    delete process.env.REDIS_URL;
    process.env.PRIMARY_LLM_PROVIDER = 'mock';
    process.env.STATE_ENTITY_EXTRACTOR_PROVIDER = 'mock';
    process.env.SERVICE_ROUTER_PROVIDER = 'mock';
    process.env.DEBUG_API = 'true';

    await prepareTestDatabase();
    app = await createTestApp();
    const slotGeneration = app.get(SlotGenerationService);
    await slotGeneration.generateSlots({
      clinicId: SEED.CLINIC_ID,
      doctorId: SEED.DOCTOR_KUMAR_ID,
      clinicServiceId: SEED.ORTHO_SERVICE_ID,
    });
    sql = postgres(process.env.DATABASE_URL, { max: 5 });
  });

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('1. after booking.greeting, Fever starts booking and does not repeat greeting', async () => {
    const sessionId = await createConversation(app, '+919222229801');
    const greeting = await sendMessage(app, sessionId, 'Hi', 'a19_greet_1');
    expect(greeting.assistant_message.reply_template_key).toBe('booking.greeting');
    expect(greeting.session.current_flow).toBe('booking');
    expect(greeting.session.current_state).toBe('ASK_PROBLEM_OR_DOCTOR');
    expect(greeting.session.collected_json.awaiting_terminal_ack).toBeUndefined();

    const classifier = app.get<IntentClassifierAdapter>(ADAPTER_TOKENS.IntentClassifierAdapter);
    const classifySpy = vi
      .spyOn(classifier, 'classify')
      .mockResolvedValueOnce(sarvamLikeMisclassification('Fever'));

    const fever = await sendMessage(app, sessionId, 'Fever', 'a19_greet_2');
    classifySpy.mockRestore();

    expect(fever.assistant_message.reply_template_key).not.toBe('booking.greeting');
    expect(fever.session.current_flow).toBe('booking');
    expect(fever.session.collected_json.reason_for_visit).toBeTruthy();
    expect(fever.session.current_state).toBe('ASK_DATE');
  });

  it('2. Fever alone maps to book_appointment with reason_for_visit', async () => {
    const sessionId = await createConversation(app, '+919222229802');
    const result = await sendMessage(app, sessionId, 'Fever', 'a19_fever_1');
    expect(result.session.current_flow).toBe('booking');
    expect(result.session.collected_json.reason_for_visit).toBeTruthy();
    expect(result.assistant_message.reply_template_key).not.toBe('booking.greeting');
  });

  it('3. Knee pain and Child fever start booking', async () => {
    const kneeSession = await createConversation(app, '+919222229803');
    const knee = await sendMessage(app, kneeSession, 'Knee pain', 'a19_knee_1');
    expect(knee.session.current_flow).toBe('booking');
    expect(knee.session.collected_json.reason_for_visit).toMatch(/knee pain/i);

    const childSession = await createConversation(app, '+919222229804');
    const child = await sendMessage(app, childSession, 'Child fever', 'a19_child_1');
    expect(child.session.current_flow).toBe('booking');
    expect(child.session.collected_json.reason_for_visit).toMatch(/child fever/i);
  });

  it('4. Fever-ku enna tablet? is medical advice', async () => {
    const sessionId = await createConversation(app, '+919222229805');
    const result = await sendMessage(app, sessionId, 'Fever-ku enna tablet?', 'a19_med_1');
    expect(result.assistant_message.reply_template_key).toBe('safety.medical_advice_refusal');
  });

  it('5. Chest pain is emergency', async () => {
    const sessionId = await createConversation(app, '+919222229806');
    const result = await sendMessage(app, sessionId, 'Chest pain', 'a19_emerg_1');
    expect(result.assistant_message.reply_template_key).toBe('safety.emergency');
  });

  it('6. ASK_DATE + Naaliku evening extracts tomorrow and evening', async () => {
    const sessionId = await createConversation(app, '+919222229807');
    await sendMessage(app, sessionId, 'Appointment venum', 'a19_date_0');
    await sendMessage(app, sessionId, 'Fever', 'a19_date_1');
    const result = await sendMessage(app, sessionId, 'Naaliku evening', 'a19_date_2');
    expect(result.session.current_flow).toBe('booking');
    expect(result.session.collected_json.preferred_date).toBe(tomorrowIso());
    expect(result.session.collected_json.time_preference).toBe('evening');
  });

  it('7. ASK_TIME + Eveng extracts evening preference', async () => {
    const sessionId = await createConversation(app, '+919222229808');
    await sendMessage(app, sessionId, 'Appointment venum', 'a19_time_0');
    await sendMessage(app, sessionId, 'Fever', 'a19_time_1');
    const bookableDate = findNextBookableDate();
    let atDate = await sendMessage(app, sessionId, bookableDate, 'a19_time_2');
    if (atDate.session.current_state === 'ASK_ALTERNATE_TIME') {
      atDate = await sendMessage(app, sessionId, `${findNextBookableDate(2)} evening`, 'a19_time_2b');
    }
    if (atDate.session.current_state === 'PROPOSE_SLOTS') {
      expect(atDate.session.collected_json.time_preference).toBe('evening');
      return;
    }
    if (atDate.session.current_state !== 'ASK_TIME') {
      const withEvening = await sendMessage(app, sessionId, 'Eveng', 'a19_time_2c');
      expect(withEvening.session.collected_json.time_preference).toBe('evening');
      return;
    }

    const result = await sendMessage(app, sessionId, 'Eveng', 'a19_time_3');
    expect(result.session.current_flow).toBe('booking');
    expect(result.session.collected_json.time_preference).toBe('evening');
  });

  it('8. fee side question at ASK_DATE answers fee and resumes date prompt', async () => {
    const sessionId = await createConversation(app, '+919222229809');
    const atDate = await sendMessage(app, sessionId, 'Fever appointment venum', 'a19_fee_1');
    expect(atDate.session.current_state).toBe('ASK_DATE');

    const feeQuestion = await sendMessage(app, sessionId, 'Dr Priya fees evlo?', 'a19_fee_2');
    expect(feeQuestion.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(feeQuestion.session.current_state).toBe('ASK_DATE');
    expect(feeQuestion.assistant_message.message_text?.toLowerCase()).toMatch(/fee|consultation|rupee|₹/i);
    expect(feeQuestion.assistant_message.message_text).toMatch(/Enna date-ku appointment venum/i);
  });

  it('9. out-of-scope during booking redirects and resumes current prompt', async () => {
    const sessionId = await createConversation(app, '+919222229810');
    await sendMessage(app, sessionId, 'Appointment venum', 'a19_oos_0');
    await sendMessage(app, sessionId, 'Fever', 'a19_oos_1');
    const atDate = await sendMessage(app, sessionId, 'Naaliku evening', 'a19_oos_2');
    expect(atDate.session.current_flow).toBe('booking');
    expect(atDate.session.collected_json.preferred_date).toBe(tomorrowIso());
    const resumeState = atDate.session.current_state;

    const redirect = await sendMessage(app, sessionId, 'Weather eppadi irukku?', 'a19_oos_3');

    expect(redirect.session.current_flow).toBe('booking');
    expect(redirect.session.current_state).toBe(resumeState);
    expect(redirect.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(redirect.assistant_message.reply_template_key).not.toBe('booking.greeting');
  });

  it('10. no duplicate appointments are created for one booking flow', async () => {
    const sessionId = await createConversation(app, '+919222229811');
    await sendMessage(app, sessionId, 'Naalaikku evening appointment venum', 'a19_dup_1');
    await sendMessage(app, sessionId, 'Knee pain', 'a19_dup_2');

    const rows = await sql`
      SELECT COUNT(*)::int AS count
      FROM appointment_requests
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND source_session_id = ${sessionId}
        AND status IN ('pending_confirmation', 'confirmed')
    `;
    expect(rows[0]?.count).toBeLessThanOrEqual(1);
  });
});
