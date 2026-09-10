import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { addDays, formatDateInTimezone } from '@vaidya/db';
import { apiSuccessBodySchema, extractStateEntitiesMock } from '@vaidya/shared';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';

const TIMEZONE = 'Asia/Kolkata';

const extractorBase = {
  clinicId: SEED.CLINIC_ID,
  sessionId: '00000000-0000-0000-0000-000000000099',
  languageCode: 'ta_tanglish',
  timezone: TIMEZONE,
  collected: {},
  expectedFields: [] as string[],
};

const offeredSlots = [
  { slotId: '00000000-0000-0000-0000-000000000101', startTime: '2026-05-16T12:00:00Z', endTime: '2026-05-16T12:30:00Z', displayTime: '6:00 PM' },
  { slotId: '00000000-0000-0000-0000-000000000102', startTime: '2026-05-16T12:30:00Z', endTime: '2026-05-16T13:00:00Z', displayTime: '6:30 PM' },
];

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
    };
    assistant_message: { reply_template_key: string | null; message_text: string };
  };
}

describe('A12 active-state LLM interpreter enhancement', () => {
  const referenceDate = '2026-05-16';
  const tomorrow = addDays(referenceDate, 1, TIMEZONE);

  describe('mock active-state interpreter unit cases', () => {
    it('1. booking/ASK_DATE + nalaki -> date_answer without flow reset', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'booking',
        currentState: 'ASK_DATE',
        messageText: 'nalaki',
        referenceDate,
        expectedFields: ['date'],
      });
      expect(result.recognizedAs).toBe('date_answer');
      expect(result.entities.date).toBe(tomorrow);
      expect(result.needsClarification).toBe(false);
    });

    it('2. booking/ASK_DATE + this saturday -> date_answer', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'booking',
        currentState: 'ASK_DATE',
        messageText: 'this saturday',
        referenceDate,
        expectedFields: ['date'],
      });
      expect(result.recognizedAs).toBe('date_answer');
      expect(result.entities.date).toBeTruthy();
    });

    it('3. booking/ASK_TIME + after 6 -> time_answer', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'booking',
        currentState: 'ASK_TIME',
        messageText: 'after 6',
        referenceDate,
        expectedFields: ['timePreference'],
      });
      expect(result.recognizedAs).toBe('time_answer');
      expect(result.entities.exactTime ?? result.entities.timePreference).toBeTruthy();
    });

    it('4. booking/ASK_TIME + 6 arai -> exactTime 18:30', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'booking',
        currentState: 'ASK_TIME',
        messageText: '6 arai',
        referenceDate,
        expectedFields: ['timePreference'],
      });
      expect(result.recognizedAs).toBe('time_answer');
      expect(result.entities.exactTime).toBe('18:30');
    });

    it('5. booking/PROPOSE_SLOTS + first one -> offered slot id', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'booking',
        currentState: 'PROPOSE_SLOTS',
        messageText: 'first one',
        referenceDate,
        offeredSlots,
        expectedFields: ['selectedSlotId'],
      });
      expect(result.recognizedAs).toBe('slot_selection');
      expect(result.entities.selectedSlotId).toBe(offeredSlots[0]!.slotId);
    });

    it('6. booking/PROPOSE_SLOTS + later slot -> later offered slot', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'booking',
        currentState: 'PROPOSE_SLOTS',
        messageText: 'later slot',
        referenceDate,
        offeredSlots,
        expectedFields: ['selectedSlotId'],
      });
      expect(result.recognizedAs).toBe('slot_selection');
      expect(result.entities.selectedSlotId).toBe(offeredSlots[1]!.slotId);
    });

    it('7. booking/PROPOSE_SLOTS + unavailable time does not invent slot id', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'booking',
        currentState: 'PROPOSE_SLOTS',
        messageText: '9:99 PM',
        referenceDate,
        offeredSlots,
        expectedFields: ['selectedSlotId'],
      });
      expect(result.recognizedAs).toBe('unknown');
      expect(result.entities.selectedSlotId).toBeNull();
      expect(result.needsClarification).toBe(true);
    });

    it('8. booking/ASK_PATIENT_NAME + Naan Ravi -> patientName', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'booking',
        currentState: 'ASK_PATIENT_NAME',
        messageText: 'Naan Ravi',
        referenceDate,
        expectedFields: ['patientName'],
      });
      expect(result.recognizedAs).toBe('patient_name');
      expect(result.entities.patientName).toBe('Ravi');
    });

    it('9. booking/ASK_PATIENT_NAME + vendam -> flow_cancel', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'booking',
        currentState: 'ASK_PATIENT_NAME',
        messageText: 'vendam',
        referenceDate,
        expectedFields: ['patientName'],
      });
      expect(result.recognizedAs).toBe('flow_cancel');
    });

    it('10. booking/CONFIRM_DETAILS + book pannunga -> yes_confirmation', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'booking',
        currentState: 'CONFIRM_DETAILS',
        messageText: 'book pannunga',
        referenceDate,
        expectedFields: [],
      });
      expect(result.recognizedAs).toBe('yes_confirmation');
    });

    it('11. cancel/CONFIRM_CANCEL_REQUEST + sari cancel pannunga -> yes_confirmation', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'cancel',
        currentState: 'CONFIRM_CANCEL_REQUEST',
        messageText: 'sari cancel pannunga',
        referenceDate,
        expectedFields: [],
      });
      expect(result.recognizedAs).toBe('yes_confirmation');
    });

    it('12. cancel/CONFIRM_CANCEL_REQUEST + vendam -> no_rejection', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'cancel',
        currentState: 'CONFIRM_CANCEL_REQUEST',
        messageText: 'vendam',
        referenceDate,
        expectedFields: [],
      });
      expect(result.recognizedAs).toBe('no_rejection');
    });

    it('13. reschedule/ASK_NEW_DATE + next friday -> date_answer', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'reschedule',
        currentState: 'ASK_NEW_DATE',
        messageText: 'next friday',
        referenceDate,
        expectedFields: ['date'],
      });
      expect(result.recognizedAs).toBe('date_answer');
      expect(result.entities.date).toBe('2026-05-22');
    });

    it('14. handoff/ASK_REASON + report pathi pesanum -> handoff_reason', () => {
      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentFlow: 'handoff',
        currentState: 'ASK_REASON',
        messageText: 'report pathi pesanum',
        referenceDate,
        expectedFields: ['reason'],
      });
      expect(result.recognizedAs).toBe('handoff_reason');
      expect(result.entities.sideQuestionTopic).toContain('report');
    });
  });

  describe('integration side question and safety overrides', () => {
    let app: NestFastifyApplication;
    let sql: postgres.Sql;

    beforeAll(async () => {
      process.env.DATABASE_URL =
        process.env.TEST_DATABASE_URL ??
        'postgresql://postgres:postgres@localhost:5433/vaidya_test';
      process.env.QUEUE_MODE = 'inline';
      process.env.NODE_ENV = 'test';
      process.env.ACTIVE_STATE_INTERPRETER_PROVIDER = 'composite';
      process.env.ACTIVE_STATE_LLM_PROVIDER = 'mock';
      delete process.env.REDIS_URL;

      await prepareTestDatabase();
      app = await createTestApp();
      sql = postgres(process.env.DATABASE_URL, { max: 5 });
    });

    afterAll(async () => {
      await app.close();
      await sql.end({ timeout: 5 });
    });

    it('15. booking/ASK_DATE side fee question preserves booking state', async () => {
      const sessionId = await createConversation(app, '+919222331201');
      const step1 = await sendMessage(app, sessionId, 'Knee pain appointment venum', 'a12_book_1');
      expect(step1.session.current_flow).toBe('booking');

      const step2 = await sendMessage(app, sessionId, 'Dr Priya fees evlo?', 'a12_side_fee');
      expect(step2.session.current_flow).toBe('booking');
      expect(step2.session.current_state).toBe('ASK_DATE');
      expect(step2.assistant_message.reply_template_key).not.toBe('booking.ask_date');
    });

    it('16. emergency during active booking bypasses interpreter', async () => {
      const sessionId = await createConversation(app, '+919222331202');
      await sendMessage(app, sessionId, 'Knee pain appointment venum', 'a12_book_2');
      const step2 = await sendMessage(app, sessionId, 'Chest pain irukku', 'a12_emergency');
      expect(step2.assistant_message.reply_template_key).toBe('safety.emergency_active_flow');

      const incidents = await sql`
        SELECT count(*)::int AS count FROM emergency_incidents WHERE source_session_id = ${sessionId}
      `;
      expect(incidents[0]?.count).toBeGreaterThan(0);
    });

    it('17. medical advice during active booking bypasses interpreter', async () => {
      const sessionId = await createConversation(app, '+919222331203');
      await sendMessage(app, sessionId, 'Knee pain appointment venum', 'a12_book_3');
      const step2 = await sendMessage(app, sessionId, 'Fever-ku enna tablet?', 'a12_medical');
      expect(step2.assistant_message.reply_template_key).toBe('safety.medical_advice_refusal_resume');
    });
  });
});
