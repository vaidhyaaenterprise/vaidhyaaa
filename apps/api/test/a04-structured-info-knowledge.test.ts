import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { apiSuccessBodySchema } from '@vaidya/shared';

import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';

const OTHER_CLINIC_ID = '00000000-0000-0000-0000-000000000002';

async function createConversation(app: NestFastifyApplication, phone = '+919222222401') {
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
    assistant_message: { reply_template_key: string | null; message_text: string };
  };
}

describe('A04 structured info and knowledge', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let slotGeneration: SlotGenerationService;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/vaidya_test';
    process.env.QUEUE_MODE = 'inline';
    delete process.env.REDIS_URL;

    await prepareTestDatabase();
    app = await createTestApp();
    sql = postgres(process.env.DATABASE_URL, { max: 5 });
    slotGeneration = app.get(SlotGenerationService);

    await slotGeneration.generateSlots({
      clinicId: SEED.CLINIC_ID,
      doctorId: SEED.DOCTOR_PRIYA_ID,
      clinicServiceId: '00000000-0000-0000-0000-000000000302',
    });

    await sql`
      INSERT INTO clinics (id, name, primary_phone, address_line1, city, state, country, timezone, default_language_code, active, onboarding_status)
      VALUES (${OTHER_CLINIC_ID}, 'Other Dental Clinic', '+914400000002', 'T Nagar', 'Chennai', 'Tamil Nadu', 'India', 'Asia/Kolkata', 'ta_tanglish', true, 'ready_for_agent')
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO clinic_knowledge_base (clinic_id, question, answer, category, alternative_phrases_json, status, search_text, approved_by_user_id, approved_at)
      VALUES
      (${OTHER_CLINIC_ID}, 'Tooth extraction-ku fasting venuma?', 'Dental clinic fasting answer from other tenant.', 'pre_visit_instruction', '["tooth extraction fasting"]', 'approved', 'tooth extraction fasting dental', ${SEED.CLINIC_ADMIN_ID}, now())
      ON CONFLICT DO NOTHING
    `;

    await sql`
      INSERT INTO clinic_knowledge_base (clinic_id, question, answer, category, alternative_phrases_json, status, search_text)
      VALUES
      (${SEED.CLINIC_ID}, 'Pending insurance answer', 'This should never be used.', 'insurance', '["insurance pending"]', 'pending_review', 'insurance pending answer')
      ON CONFLICT DO NOTHING
    `;
  });

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('1. doctor-specific fee comes from structured DB', async () => {
    const sessionId = await createConversation(app, '+919222222411');
    const result = await sendMessage(app, sessionId, 'Dr Priya fees evlo?', 'a04_fee_1');
    expect(result.assistant_message.reply_template_key).toBe('fee.answer');
    expect(result.assistant_message.message_text).toContain('700');
    expect(result.assistant_message.message_text.toLowerCase()).toContain('priya');
    expect(result.session.current_flow).toBe('none');
  });

  it('2. fee clarification flow: Fees evlo? then Dr Murugan', async () => {
    const sessionId = await createConversation(app, '+919222222412');
    const step1 = await sendMessage(app, sessionId, 'Fees evlo?', 'a04_fee_2a');
    expect(step1.assistant_message.reply_template_key).toBe('fee.ask_doctor');
    expect(step1.session.current_flow).toBe('fee_clarification');

    const step2 = await sendMessage(app, sessionId, 'Dr. Murugan', 'a04_fee_2b');
    expect(step2.assistant_message.reply_template_key).toBe('fee.answer');
    expect(step2.assistant_message.message_text).toContain('500');
    expect(step2.session.current_flow).toBe('none');
  });

  it('3. follow-up fee returns only follow-up fee', async () => {
    const sessionId = await createConversation(app, '+919222222413');
    const result = await sendMessage(
      app,
      sessionId,
      'Dr Murugan follow-up fee evlo?',
      'a04_fee_3',
    );
    expect(result.assistant_message.reply_template_key).toBe('fee.followup_answer');
    expect(result.assistant_message.message_text).toContain('300');
    expect(result.assistant_message.message_text).not.toContain('500');
  });

  it('4. MRI scan fee returns staff confirmation without doctor ask', async () => {
    const sessionId = await createConversation(app, '+919222222414');
    const result = await sendMessage(app, sessionId, 'MRI scan fee evlo?', 'a04_fee_4');
    expect(result.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(result.assistant_message.message_text.toLowerCase()).toContain('staff');
    expect(result.assistant_message.message_text.toLowerCase()).not.toContain('edha doctor');
  });

  it('5. Sunday open returns Sunday-only answer', async () => {
    const sessionId = await createConversation(app, '+919222222415');
    const result = await sendMessage(app, sessionId, 'Sunday open-a?', 'a04_timing_5');
    expect(result.assistant_message.reply_template_key).toBe('timing.day_closed');
    expect(result.assistant_message.message_text.toLowerCase()).toContain('sunday');
  });

  it('6. clinic timing general question uses structured hours', async () => {
    const sessionId = await createConversation(app, '+919222222416');
    const result = await sendMessage(app, sessionId, 'Clinic timing enna?', 'a04_timing_6');
    expect(result.assistant_message.reply_template_key).toBe('timing.answer');
    expect(result.assistant_message.message_text).toMatch(/09:00|9:00|17:00/i);
    const mondaySection = result.assistant_message.message_text.match(/Mon [^;]+/)?.[0] ?? '';
    expect(mondaySection.match(/09:00-13:00/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(mondaySection.match(/17:00-21:00/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it('7. location comes from clinics table', async () => {
    const sessionId = await createConversation(app, '+919222222417');
    const result = await sendMessage(app, sessionId, 'Clinic enga irukku?', 'a04_loc_7');
    expect(result.assistant_message.reply_template_key).toBe('location.answer');
    expect(result.assistant_message.message_text).toContain('Anna Nagar');
    expect(result.assistant_message.message_text).toContain('Chennai');
  });

  it('8. doctor availability today returns slots or not scheduled', async () => {
    const sessionId = await createConversation(app, '+919222222418');
    const result = await sendMessage(
      app,
      sessionId,
      'Dr Priya inniku irukkangala?',
      'a04_avail_8',
    );
    expect(['availability.today_slots', 'availability.no_slots', 'availability.not_available']).toContain(
      result.assistant_message.reply_template_key,
    );
    expect(result.session.current_flow).toBe('none');

    const appointments = await sql`
      SELECT count(*)::int AS count FROM appointment_requests WHERE source_session_id = ${sessionId}
    `;
    expect(appointments[0]?.count).toBe(0);
  });

  it('8b. doctor availability tomorrow is detected', async () => {
    const sessionId = await createConversation(app, '+9192222224181');
    const result = await sendMessage(
      app,
      sessionId,
      'Dr Priya naalaiku irukkangala?',
      'a04_avail_8b',
    );
    expect(['availability.today_slots', 'availability.no_slots', 'availability.not_available']).toContain(
      result.assistant_message.reply_template_key,
    );
    expect(result.session.current_flow).toBe('none');
    if (result.assistant_message.reply_template_key === 'availability.today_slots') {
      expect(result.assistant_message.message_text.toLowerCase()).toContain('naalaikku');
    }
  });

  it('9. approved scan fasting answer works', async () => {
    const sessionId = await createConversation(app, '+919222222419');
    const result = await sendMessage(app, sessionId, 'Scan-ku fasting venuma?', 'a04_kb_9');
    expect(result.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(result.assistant_message.message_text.toLowerCase()).toContain('fasting');
  });

  it('10. alternative wording finds approved scan answer', async () => {
    const sessionId = await createConversation(app, '+919222222420');
    const result = await sendMessage(app, sessionId, 'Scan-ku sapdalaama?', 'a04_kb_10');
    expect(result.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(result.assistant_message.message_text.toLowerCase()).toContain('scan');
  });

  it('11. pending knowledge is not used', async () => {
    const sessionId = await createConversation(app, '+919222222421');
    const result = await sendMessage(app, sessionId, 'Insurance pending answer?', 'a04_kb_11');
    expect(result.assistant_message.message_text).not.toContain('should never be used');
    expect(result.assistant_message.message_text.toLowerCase()).toContain('staff');
  });

  it('12. other clinic knowledge is not used', async () => {
    const sessionId = await createConversation(app, '+919222222422');
    const result = await sendMessage(
      app,
      sessionId,
      'Tooth extraction-ku fasting venuma?',
      'a04_kb_12',
    );
    expect(result.assistant_message.message_text).not.toContain('Dental clinic fasting answer');
    expect(result.assistant_message.message_text.toLowerCase()).toContain('staff');
  });

  it('13. parking knowledge side-question during booking resumes state', async () => {
    const sessionId = await createConversation(app, '+919222222423');
    const step1 = await sendMessage(
      app,
      sessionId,
      'Naalaikku evening appointment venum',
      'a04_side_13a',
    );
    expect(step1.session.current_flow).toBe('booking');
    expect(['ASK_PROBLEM_OR_DOCTOR', 'ASK_DATE', 'ASK_REASON']).toContain(step1.session.current_state);

    const step2 = await sendMessage(app, sessionId, 'Parking irukka?', 'a04_side_13b');
    expect(step2.session.current_flow).toBe('booking');
    expect(['ASK_PROBLEM_OR_DOCTOR', 'ASK_DATE', 'ASK_REASON']).toContain(step2.session.current_state);
    expect(step2.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step2.assistant_message.message_text.toLowerCase()).toContain('parking');
    expect(step2.assistant_message.message_text).toMatch(
      /Endha doctor-a paakanum|Enna problem-ku appointment venum|Enna date-ku appointment venum/i,
    );
  });

  it('14. knowledge side-question during ASK_DATE resumes date prompt', async () => {
    const sessionId = await createConversation(app, '+919222222424');
    const step1 = await sendMessage(app, sessionId, 'Fever appointment venum', 'a04_side_14a');
    expect(step1.session.current_flow).toBe('booking');
    expect(step1.session.current_state).toBe('ASK_DATE');

    const step2 = await sendMessage(app, sessionId, 'Scan-ku fasting venuma?', 'a04_side_14b');
    expect(step2.session.current_flow).toBe('booking');
    expect(step2.session.current_state).toBe('ASK_DATE');
    expect(step2.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step2.assistant_message.message_text.toLowerCase()).toContain('fasting');
    expect(step2.assistant_message.message_text).toContain('Enna date-ku appointment venum');
  });

  it('15. medical advice does not use knowledge', async () => {
    const sessionId = await createConversation(app, '+919222222425');
    const result = await sendMessage(app, sessionId, 'Fever-ku enna tablet?', 'a04_safe_15');
    expect(result.assistant_message.reply_template_key).toBe('safety.medical_advice_refusal');
    expect(result.assistant_message.message_text.toLowerCase()).not.toContain('parking');
  });

  it('16. emergency does not use knowledge', async () => {
    const sessionId = await createConversation(app, '+919222222426');
    const result = await sendMessage(app, sessionId, 'Chest pain, breathing kashtama', 'a04_safe_16');
    expect(result.assistant_message.reply_template_key).toBe('safety.emergency');
    expect(result.assistant_message.message_text).toContain('108');
  });

  it('17. clinic identity question answers from structured clinic context', async () => {
    const sessionId = await createConversation(app, '+919222222427');
    const result = await sendMessage(app, sessionId, 'Ithu Sri Murugan Clinic ah', 'a04_clinic_17');
    expect(result.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(result.assistant_message.message_text.toLowerCase()).toContain('murugan');
    expect(result.assistant_message.message_text.toLowerCase()).not.toContain('enna problem');
  });

  it('18. unknown parking question searches knowledge before clarify', async () => {
    const sessionId = await createConversation(app, '+919222222428');
    const result = await sendMessage(app, sessionId, 'Parking irukka?', 'a04_kb_18');
    expect(result.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(result.assistant_message.message_text.toLowerCase()).toContain('parking');
    expect(result.assistant_message.message_text.toLowerCase()).not.toContain('puriyala');
  });
});
