import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { apiSuccessBodySchema } from '@vaidya/shared';

import { addDays, dayOfWeekMon1, formatDateInTimezone } from '@vaidya/db';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';
import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';
import { SlotService } from '../src/modules/slots/slot.service';
import { slotHour } from '../src/modules/booking/booking-field-extractor';

const TIMEZONE = 'Asia/Kolkata';

function eveningSlotTime(startTime: string): string {
  const timePart = startTime.includes(' ') ? (startTime.split(' ')[1] ?? startTime) : startTime;
  return timePart.slice(0, 5);
}

async function pickEveningSlotTime(
  app: NestFastifyApplication,
  bookingDate: string,
): Promise<string> {
  const slotService = app.get(SlotService);
  const slots = await slotService.findAvailableSlots(
    SEED.CLINIC_ID,
    SEED.DOCTOR_KUMAR_ID,
    SEED.ORTHO_SERVICE_ID,
  );
  const eveningSlots = slots
    .filter((slot) => slot.start_time.startsWith(bookingDate) && slotHour(slot.start_time) >= 17)
    .sort((left, right) => left.start_time.localeCompare(right.start_time));
  expect(eveningSlots.length).toBeGreaterThan(0);
  return eveningSlotTime(eveningSlots[0]!.start_time);
}

function findBookableDate(minOffsetFromToday = 1): string {
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
    assistant_message: { reply_template_key: string | null; intent?: string | null };
  };
}

describe('booking flow regression (user scenario)', () => {
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
    process.env.CONVERSATION_AGENT_MODE = 'legacy';

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

  it('matches reported broken flow: knee pain at ASK_DATE, then June 30, then knee pain again', async () => {
    const sessionId = await createConversation(app, '+919222229903');

    const step0 = await sendMessage(app, sessionId, 'Fever appointment venum', 'user_flow_0');
    expect(step0.session.current_flow).toBe('booking');
    expect(step0.session.current_state).toBe('ASK_DATE');

    const step1 = await sendMessage(app, sessionId, 'Knee pain', 'user_flow_1');
    expect(step1.session.current_flow).toBe('booking');
    expect(step1.session.collected_json.reason_for_visit).toBeTruthy();
    expect(step1.assistant_message.reply_template_key).toBe('booking.ask_date');
    expect(step1.session.current_state).toBe('ASK_DATE');

    const step2 = await sendMessage(app, sessionId, 'June 30', 'user_flow_2');
    expect(step2.session.current_flow).toBe('booking');
    expect(step2.session.collected_json.preferred_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(step2.session.current_state).not.toBe('ASK_DATE');
    expect(step2.session.current_state).not.toBe('ASK_PROBLEM_OR_DOCTOR');

    const step3 = await sendMessage(app, sessionId, 'Knee Pain', 'user_flow_3');
    expect(step3.session.current_flow).toBe('booking');
    expect(step3.session.status).toBe('active');
    expect(step3.assistant_message.reply_template_key).not.toBe('booking.greeting');
    expect(step3.assistant_message.intent).not.toBe('greeting');
  });

  it('problem first, then date: Fever ku -> June 30', async () => {
    const sessionId = await createConversation(app, '+919222229901');

    const step1 = await sendMessage(app, sessionId, 'Appointment venum', 'flow_reg_1');
    expect(step1.session.current_state).toBe('ASK_PROBLEM_OR_DOCTOR');

    const step2 = await sendMessage(app, sessionId, 'Fever ku', 'flow_reg_2');
    expect(step2.session.collected_json.reason_for_visit).toBeTruthy();
    expect(step2.session.current_state).toBe('ASK_DATE');

    const step3 = await sendMessage(app, sessionId, 'June 30', 'flow_reg_3');
    expect(step3.session.collected_json.preferred_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(step3.session.current_state).not.toBe('ASK_DATE');
  });

  it('date at ASK_DATE without reason asks reason and keeps date', async () => {
    const sessionId = await createConversation(app, '+919222229905');

    const step0 = await sendMessage(app, sessionId, 'Appointment venum', 'date_only_0');
    expect(step0.session.current_state).toBe('ASK_PROBLEM_OR_DOCTOR');

    const step1 = await sendMessage(app, sessionId, 'June 30', 'date_only_1');
    expect(step1.session.collected_json.preferred_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(step1.session.current_state).toBe('ASK_REASON');
    expect(step1.assistant_message.reply_template_key).toBe('booking.ask_reason');
  });

  it('matches user bug: repeat date at ASK_REASON, then knee pain', async () => {
    const sessionId = await createConversation(app, '+919222229906');

    const step0 = await sendMessage(app, sessionId, 'Appointment venum', 'bug_flow_0');
    expect(step0.session.current_state).toBe('ASK_PROBLEM_OR_DOCTOR');

    const step1 = await sendMessage(app, sessionId, 'June 29', 'bug_flow_1');
    expect(step1.session.collected_json.preferred_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(step1.session.current_state).toBe('ASK_REASON');
    expect(step1.assistant_message.reply_template_key).toBe('booking.ask_reason');

    const step2 = await sendMessage(app, sessionId, 'June 29', 'bug_flow_2');
    expect(step2.session.current_flow).toBe('booking');
    expect(step2.session.collected_json.preferred_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(step2.session.current_state).toBe('ASK_REASON');
    expect(step2.assistant_message.reply_template_key).toBe('booking.ask_reason');
    expect(step2.assistant_message.reply_template_key).not.toBe('booking.ask_date');

    const step3 = await sendMessage(app, sessionId, 'Knee Pain', 'bug_flow_3');
    expect(step3.session.current_flow).toBe('booking');
    expect(step3.session.collected_json.reason_for_visit).toBeTruthy();
    expect(step3.assistant_message.reply_template_key).not.toBe('booking.greeting');
    expect(step3.assistant_message.intent).not.toBe('greeting');
    expect(step3.session.current_state).not.toBe('ASK_REASON');
  });

  it('selects offered slot at PROPOSE_SLOTS instead of re-proposing', async () => {
    const bookingDate = findBookableDate();
    const slotTime = await pickEveningSlotTime(app, bookingDate);
    const sessionId = await createConversation(app, '+919222229907');

    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'slot_sel_0');
    const propose = await sendMessage(app, sessionId, 'Knee pain', 'slot_sel_1');
    expect(propose.session.current_state).toBe('PROPOSE_SLOTS');
    expect(propose.assistant_message.reply_template_key).toBe('booking.propose_slots');

    const selected = await sendMessage(app, sessionId, slotTime, 'slot_sel_3');
    expect(selected.session.current_flow).toBe('booking');
    expect(selected.assistant_message.reply_template_key).not.toBe('booking.propose_slots');
    expect(selected.session.collected_json.hold_id).toBeTruthy();
    expect(selected.session.collected_json.selected_slot_id).toBeTruthy();
  });
});
