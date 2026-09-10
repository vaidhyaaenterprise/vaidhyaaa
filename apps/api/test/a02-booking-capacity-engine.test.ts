import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { addDays, dayOfWeekMon1, formatDateInTimezone } from '@vaidya/db';
import { apiSuccessBodySchema, AppError } from '@vaidya/shared';

import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';
import { SlotHoldService } from '../src/modules/slots/slot-hold.service';
import { SlotService } from '../src/modules/slots/slot.service';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';

const TIMEZONE = 'Asia/Kolkata';

function findNextBookableDate(timezone: string, minOffsetFromToday = 1): string {
  const today = formatDateInTimezone(new Date(), timezone);
  for (let offset = minOffsetFromToday; offset <= 30; offset += 1) {
    const candidate = addDays(today, offset, timezone);
    const dayOfWeek = dayOfWeekMon1(candidate, timezone);
    if (dayOfWeek >= 1 && dayOfWeek <= 6) {
      return candidate;
    }
  }
  throw new Error('No bookable weekday found in test horizon');
}

function eveningRetryMessage(date: string): string {
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const [, month, day] = date.split('-');
  return `${monthNames[Number(month) - 1]} ${Number(day)} evening`;
}

async function createConversation(app: NestFastifyApplication, phone = '+919222222201') {
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

describe('A02 booking capacity engine', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let slotGeneration: SlotGenerationService;
  let slotHold: SlotHoldService;
  let slotService: SlotService;

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
    slotHold = app.get(SlotHoldService);
    slotService = app.get(SlotService);

    await slotGeneration.generateSlots({
      clinicId: SEED.CLINIC_ID,
      doctorId: SEED.DOCTOR_KUMAR_ID,
      clinicServiceId: SEED.ORTHO_SERVICE_ID,
    });
  });

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('1. happy path: problem -> service -> doctor -> slots -> hold -> name -> confirmation -> appointment', async () => {
    const sessionId = await createConversation(app, '+919222222301');

    const step1 = await sendMessage(app, sessionId, 'Naalaikku evening appointment venum', 'a02_hp_1');
    expect(step1.session.current_flow).toBe('booking');
    expect(step1.assistant_message.reply_template_key).toBe('booking.ask_reason');

    const step2 = await sendMessage(app, sessionId, 'Knee pain', 'a02_hp_2');
    expect(step2.assistant_message.reply_template_key).toBe('booking.propose_slots');
    expect(step2.session.collected_json.clinic_service_id).toBe(SEED.ORTHO_SERVICE_ID);
    expect(step2.session.collected_json.doctor_id).toBe(SEED.DOCTOR_KUMAR_ID);

    const holdsBefore = await sql`
      SELECT count(*)::int AS count FROM slot_holds WHERE session_id = ${sessionId}
    `;
    expect(holdsBefore[0]?.count).toBe(0);

    const step3 = await sendMessage(app, sessionId, '6:30', 'a02_hp_3');
    expect(step3.assistant_message.reply_template_key).toBe('booking.ask_patient_name');
    expect(step3.session.collected_json.hold_id).toBeTruthy();

    const holdsAfter = await sql`
      SELECT status FROM slot_holds WHERE session_id = ${sessionId}
    `;
    expect(holdsAfter).toHaveLength(1);
    expect(holdsAfter[0]?.status).toBe('active');

    const step4 = await sendMessage(app, sessionId, 'Kumar', 'a02_hp_4');
    expect(step4.assistant_message.reply_template_key).toBe('booking.confirm_doctor');

    const step5 = await sendMessage(app, sessionId, 'Seri', 'a02_hp_5');
    expect(step5.assistant_message.reply_template_key).toBe('booking.created_pending');
    expect(step5.session.current_state).toBe('DONE');
    expect(step5.session.status).toBe('active');
    expect(step5.session.collected_json.awaiting_terminal_ack).toBe('booking_complete');

    const step6 = await sendMessage(app, sessionId, 'Okay', 'a02_hp_6');
    expect(step6.assistant_message.reply_template_key).toBe('ack.okay_offer_help');
    expect(step6.session.current_flow).toBe('none');
    expect(step6.session.current_state).toBe('IDLE');
    expect(step6.session.status).toBe('completed');
    expect(step6.session.collected_json.awaiting_terminal_ack).toBeUndefined();

    const step7 = await sendMessage(app, sessionId, 'Vendam', 'a02_hp_7');
    expect(step7.assistant_message.reply_template_key).not.toBe('booking.created_pending');

    const [appointment] = await sql<{
      status: string;
      reason_for_visit: string;
      doctor_id: string;
      clinic_service_id: string;
      slot_id: string;
      source_session_id: string;
    }[]>`
      SELECT status, reason_for_visit, doctor_id, clinic_service_id, slot_id, source_session_id
      FROM appointment_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(appointment?.status).toBe('pending_confirmation');
    expect(appointment?.reason_for_visit).toBe('knee pain');
    expect(appointment?.doctor_id).toBe(SEED.DOCTOR_KUMAR_ID);
    expect(appointment?.clinic_service_id).toBe(SEED.ORTHO_SERVICE_ID);
    expect(appointment?.slot_id).toBeTruthy();
    expect(appointment?.source_session_id).toBe(sessionId);

    const [hold] = await sql<{ status: string }[]>`
      SELECT status FROM slot_holds WHERE session_id = ${sessionId}
    `;
    expect(hold?.status).toBe('converted');
  });

  it('2. slot proposal does not create holds', async () => {
    const sessionId = await createConversation(app, '+919222222302');
    await sendMessage(app, sessionId, 'Naalaikku evening appointment venum', 'a02_prop_1');
    await sendMessage(app, sessionId, 'Knee pain', 'a02_prop_2');

    const holds = await sql`
      SELECT count(*)::int AS count FROM slot_holds WHERE session_id = ${sessionId}
    `;
    expect(holds[0]?.count).toBe(0);
  });

  it('3. cancel during booking releases hold and resets flow', async () => {
    const sessionId = await createConversation(app, '+919222222303');
    await sendMessage(app, sessionId, 'Naalaikku evening appointment venum', 'a02_cancel_1');
    await sendMessage(app, sessionId, 'Knee pain', 'a02_cancel_2');
    const held = await sendMessage(app, sessionId, '7:00', 'a02_cancel_3');
    expect(held.assistant_message.reply_template_key).toBe('booking.ask_patient_name');
    expect(held.session.collected_json.hold_id).toBeTruthy();

    const cancel = await sendMessage(app, sessionId, 'vendam', 'a02_cancel_4');
    expect(cancel.assistant_message.reply_template_key).toBe('booking.flow_cancelled');
    expect(cancel.session.current_flow).toBe('none');
    expect(cancel.session.current_state).toBe('IDLE');

    const [hold] = await sql<{ status: string }[]>`
      SELECT status FROM slot_holds
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(hold?.status).toBe('released');

    const appointments = await sql`
      SELECT count(*)::int AS count FROM appointment_requests WHERE source_session_id = ${sessionId}
    `;
    expect(appointments[0]?.count).toBe(0);
  });

  it('4. capacity=2 slot allows two bookings and blocks third hold', async () => {
    const tomorrow = addDays(formatDateInTimezone(new Date(), TIMEZONE), 1, TIMEZONE);
    const [slot] = await sql<{ id: string }[]>`
      SELECT id
      FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_KUMAR_ID}
        AND clinic_service_id = ${SEED.ORTHO_SERVICE_ID}
        AND status = 'open'
        AND start_time::text LIKE ${`${tomorrow} 18:30:%`}
      LIMIT 1
    `;
    if (!slot) {
      throw new Error('Expected Kumar 18:30 slot for capacity test');
    }

    await sql`
      UPDATE appointment_requests
      SET status = 'cancelled'
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND slot_id = ${slot.id}
        AND status IN ('pending_confirmation', 'confirmed')
    `;
    await sql`
      UPDATE slot_holds
      SET status = 'released'
      WHERE clinic_id = ${SEED.CLINIC_ID} AND slot_id = ${slot.id} AND status = 'active'
    `;
    await sql`
      UPDATE appointment_slots SET capacity_total = 2
      WHERE clinic_id = ${SEED.CLINIC_ID} AND id = ${slot.id}
    `;

    const hold1 = await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
    });
    const hold2 = await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
    });
    expect(hold1.id).not.toBe(hold2.id);

    await expect(
      slotHold.holdSlot({
        clinicId: SEED.CLINIC_ID,
        slotId: slot.id,
      }),
    ).rejects.toBeInstanceOf(AppError);

    await sql`
      UPDATE appointment_slots
      SET capacity_total = 1
      WHERE clinic_id = ${SEED.CLINIC_ID} AND id = ${slot.id}
    `;
  });

  it('5. concurrent hold on capacity=1 slot allows only one success', async () => {
    const tomorrow = addDays(formatDateInTimezone(new Date(), TIMEZONE), 1, TIMEZONE);
    const [slot] = await sql<{ id: string }[]>`
      SELECT id
      FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_KUMAR_ID}
        AND clinic_service_id = ${SEED.ORTHO_SERVICE_ID}
        AND status = 'open'
        AND start_time::text LIKE ${`${tomorrow} 19:00:%`}
      LIMIT 1
    `;
    if (!slot) {
      throw new Error('Expected Kumar 19:00 slot for concurrency test');
    }

    await sql`
      UPDATE appointment_slots SET capacity_total = 1
      WHERE clinic_id = ${SEED.CLINIC_ID} AND id = ${slot.id}
    `;

    const results = await Promise.allSettled([
      slotHold.holdSlot({ clinicId: SEED.CLINIC_ID, slotId: slot.id }),
      slotHold.holdSlot({ clinicId: SEED.CLINIC_ID, slotId: slot.id }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it('6. proposed slot becomes full before selection offers alternatives', async () => {
    const sessionA = await createConversation(app, '+919222222304');
    const sessionB = await createConversation(app, '+919222222305');

    await sendMessage(app, sessionA, 'Naalaikku evening appointment venum', 'a02_stale_a1');
    await sendMessage(app, sessionA, 'Knee pain', 'a02_stale_a2');

    const step2 = await sendMessage(app, sessionA, 'Knee pain', 'a02_stale_a2');
    const proposedSlots = step2.session.collected_json.proposed_slots as Array<{
      slot_id: string;
      display_time: string;
    }>;
    const targetSlot = proposedSlots.find((slot) => slot.display_time === '6:30') ?? proposedSlots[0];
    if (!targetSlot) {
      throw new Error('No proposed slot found for stale booking test');
    }

    await sql`
      UPDATE appointment_slots SET capacity_total = 1
      WHERE clinic_id = ${SEED.CLINIC_ID} AND id = ${targetSlot.slot_id}::uuid
    `;

    await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: targetSlot.slot_id,
      sessionId: sessionB,
    });

    const stale = await sendMessage(app, sessionA, '6:30', 'a02_stale_a3');
    expect(['booking.slot_unavailable', 'booking.propose_slots', 'availability.no_slots']).toContain(
      stale.assistant_message.reply_template_key,
    );
    expect(stale.session.collected_json.hold_id).toBeFalsy();
  });

  it('7. confirm after expired hold re-checks capacity', async () => {
    const sessionId = await createConversation(app, '+919222222306');
    await sendMessage(app, sessionId, 'Naalaikku evening appointment venum', 'a02_exp_1');
    await sendMessage(app, sessionId, 'Knee pain', 'a02_exp_2');
    const held = await sendMessage(app, sessionId, '7:30', 'a02_exp_3');
    expect(held.assistant_message.reply_template_key).toBe('booking.ask_patient_name');
    expect(held.session.collected_json.hold_id).toBeTruthy();

    const afterHold = await sendMessage(app, sessionId, 'Ravi', 'a02_exp_4');
    expect(afterHold.assistant_message.reply_template_key).toBe('booking.confirm_doctor');
    expect(afterHold.session.collected_json.hold_id).toBeTruthy();

    await sql`
      UPDATE slot_holds
      SET hold_expires_at = NOW() - INTERVAL '1 minute'
      WHERE session_id = ${sessionId}
    `;

    const confirm = await sendMessage(app, sessionId, 'Seri', 'a02_exp_5');
    expect(confirm.assistant_message.reply_template_key).toBe('booking.created_pending');

    const appointments = await sql`
      SELECT count(*)::int AS count FROM appointment_requests WHERE source_session_id = ${sessionId}
    `;
    expect(appointments[0]?.count).toBe(1);
  });

  it('8. unsupported service does not create appointment and acknowledges okay', async () => {
    const sessionId = await createConversation(app, '+919222222307');
    const unsupported = await sendMessage(app, sessionId, 'Eye checkup appointment venum', 'a02_unsup_1');
    expect(unsupported.assistant_message.reply_template_key).toBe('scope.unsupported_service');
    expect(unsupported.assistant_message.message_text.toLowerCase()).toContain('available illa');

    const ack = await sendMessage(app, sessionId, 'okay', 'a02_unsup_2');
    expect(ack.assistant_message.reply_template_key).toBe('ack.okay_offer_help');

    const done = await sendMessage(app, sessionId, 'vendam', 'a02_unsup_3');
    expect(done.assistant_message.reply_template_key).not.toBe('booking.created_pending');

    const appointments = await sql`
      SELECT count(*)::int AS count FROM appointment_requests WHERE source_session_id = ${sessionId}
    `;
    expect(appointments[0]?.count).toBe(0);
  });

  it('9. returning patient follow-up prefers previous doctor when identity is clear', async () => {
    const phone = '+919222222308';
    const [patient] = await sql<{ id: string }[]>`
      INSERT INTO patients (clinic_id, name, normalized_name, phone, normalized_phone)
      VALUES (
        ${SEED.CLINIC_ID},
        'Ravi Kumar',
        'ravi kumar',
        ${phone},
        ${phone.replace(/\D/g, '')}
      )
      RETURNING id
    `;

    await sql`
      INSERT INTO patient_visits (
        clinic_id, patient_id, doctor_id, clinic_service_id, reason_for_visit, normalized_reason, visited_at
      )
      VALUES (
        ${SEED.CLINIC_ID},
        ${patient!.id},
        ${SEED.DOCTOR_KUMAR_ID},
        ${SEED.ORTHO_SERVICE_ID},
        'knee pain',
        'knee pain',
        NOW() - INTERVAL '10 days'
      )
    `;

    const sessionId = await createConversation(app, phone);
    const response = await sendMessage(
      app,
      sessionId,
      'Knee pain follow-up appointment venum',
      'a02_return_1',
    );

    expect(response.session.collected_json.doctor_id).toBe(SEED.DOCTOR_KUMAR_ID);
    expect(response.session.collected_json.routing_source).toBe('returning_patient_followup');
    expect(response.session.collected_json.patient_name).toBe('Ravi Kumar');

    await sendMessage(app, sessionId, 'Naalaikku evening', 'a02_return_2');
    const proposed = await sendMessage(app, sessionId, 'Knee pain', 'a02_return_2b');
    const slots = (proposed.session.collected_json.proposed_slots ?? []) as Array<{
      display_time: string;
    }>;
    const slotTime = slots[0]?.display_time ?? '6:30';
    const slotPick = await sendMessage(app, sessionId, slotTime, 'a02_return_3');
    expect(slotPick.assistant_message.reply_template_key).toBe('booking.confirm_doctor');
    expect(slotPick.assistant_message.message_text).toContain('Kumar');
    expect(slotPick.assistant_message.message_text).not.toContain('{doctor_name}');
  });

  it('10. same phone multiple patients asks for patient identity', async () => {
    const phone = '+919222222309';
    await sql`
      INSERT INTO patients (clinic_id, name, normalized_name, phone, normalized_phone)
      VALUES
        (${SEED.CLINIC_ID}, 'Arun Kumar', 'arun kumar', ${phone}, ${phone.replace(/\D/g, '')}),
        (${SEED.CLINIC_ID}, 'Anu Kumar', 'anu kumar', ${phone}, ${phone.replace(/\D/g, '')})
    `;

    const sessionId = await createConversation(app, phone);
    const response = await sendMessage(
      app,
      sessionId,
      'Knee pain follow-up appointment venum',
      'a02_multi_1',
    );

    expect(response.session.current_state).toBe('ASK_PATIENT_IDENTITY');
    expect(response.session.collected_json.pending_patient_candidates).toBeTruthy();
  });

  it('11. hold expiry stops consuming capacity', async () => {
    const tomorrow = addDays(formatDateInTimezone(new Date(), TIMEZONE), 1, TIMEZONE);
    const [slot] = await sql<{ id: string }[]>`
      SELECT id
      FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_KUMAR_ID}
        AND clinic_service_id = ${SEED.ORTHO_SERVICE_ID}
        AND status = 'open'
        AND start_time::text LIKE ${`${tomorrow} 19:30:%`}
      LIMIT 1
    `;
    if (!slot) {
      throw new Error('Expected slot for hold expiry capacity test');
    }

    await sql`
      UPDATE appointment_requests
      SET status = 'cancelled'
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND slot_id = ${slot.id}
        AND status IN ('pending_confirmation', 'confirmed')
    `;
    await sql`
      UPDATE slot_holds
      SET status = 'released'
      WHERE clinic_id = ${SEED.CLINIC_ID} AND slot_id = ${slot.id}
    `;

    const hold = await slotHold.holdSlot({ clinicId: SEED.CLINIC_ID, slotId: slot.id });
    await sql`
      UPDATE slot_holds
      SET hold_expires_at = NOW() - INTERVAL '1 minute'
      WHERE id = ${hold.id}
    `;

    const availability = await slotService.getSlotAvailability(SEED.CLINIC_ID, slot.id);
    expect(availability?.available_count).toBeGreaterThan(0);
  });

  it('12. greeting okay re-asks problem instead of terminal offer_help', async () => {
    const sessionId = await createConversation(app, '+919222222309');
    const greeting = await sendMessage(app, sessionId, 'Hi', 'a02_greet_1');
    expect(greeting.assistant_message.reply_template_key).toBe('booking.greeting');
    expect(greeting.session.current_flow).toBe('booking');
    expect(greeting.session.current_state).toBe('ASK_PROBLEM_OR_DOCTOR');
    expect(greeting.session.collected_json.awaiting_terminal_ack).toBeUndefined();

    const ack = await sendMessage(app, sessionId, 'okay', 'a02_greet_2');
    expect(ack.assistant_message.reply_template_key).toBe('booking.ask_problem_or_doctor');
    expect(ack.session.current_flow).toBe('booking');
    expect(ack.session.current_state).toBe('ASK_PROBLEM_OR_DOCTOR');
  });

  it('13. bare doctor name selects doctor and asks reason', async () => {
    const sessionId = await createConversation(app, '+919222222310');
    await sendMessage(app, sessionId, 'Appointment venum', 'a02_doc_1');
    const doctorPick = await sendMessage(app, sessionId, 'Murugan', 'a02_doc_2');

    expect(doctorPick.assistant_message.reply_template_key).toBe('booking.ask_reason');
    expect(doctorPick.session.collected_json.doctor_id).toBe(SEED.DOCTOR_MURUGAN_ID);

    const withDate = await sendMessage(app, sessionId, 'Naalaikku evening', 'a02_doc_3');
    expect(withDate.session.collected_json.preferred_date).toBeTruthy();
    expect(withDate.session.current_state).not.toBe('ASK_DATE');
  });

  it('14. date change at ask-time uses only available time bands', async () => {
    const futureDate = findNextBookableDate(TIMEZONE, 20);
    const [futureYear, futureMonth, futureDay] = futureDate.split('-');
    const sessionId = await createConversation(app, '+919222222311');
    await sendMessage(app, sessionId, 'Appointment venum', 'a02_date_1');
    await sendMessage(app, sessionId, 'Knee pain', 'a02_date_2');
    await sendMessage(app, sessionId, 'tomorrow', 'a02_date_3');

    const dateWhileAskingTime = await sendMessage(
      app,
      sessionId,
      `${futureDay}-${futureMonth}-${futureYear}`,
      'a02_date_4',
    );
    expect(dateWhileAskingTime.session.collected_json.preferred_date).toBe(futureDate);
    expect(['booking.ask_time', 'booking.propose_slots', 'booking.ask_alternate_time']).toContain(
      dateWhileAskingTime.assistant_message.reply_template_key,
    );
    if (dateWhileAskingTime.assistant_message.reply_template_key === 'booking.propose_slots') {
      expect(dateWhileAskingTime.session.collected_json.time_preference).toBe('evening');
    }
  });

  it('15. no slots asks alternate time and continues after new preference', async () => {
    const sessionId = await createConversation(app, '+919222222312');
    await sendMessage(app, sessionId, 'Appointment venum', 'a02_alt_1');
    await sendMessage(app, sessionId, 'Knee pain', 'a02_alt_2');
    const noSlots = await sendMessage(app, sessionId, '25-12-2026 evening', 'a02_alt_3');
    expect(noSlots.assistant_message.reply_template_key).toBe('booking.ask_alternate_time');
    expect(noSlots.session.collected_json.awaiting_alternate_slot).toBe(true);

    const retry = await sendMessage(
      app,
      sessionId,
      eveningRetryMessage(findNextBookableDate(TIMEZONE)),
      'a02_alt_4',
    );
    expect(retry.assistant_message.reply_template_key).toBe('booking.propose_slots');
    expect(retry.session.collected_json.awaiting_alternate_slot).toBeFalsy();
    expect(retry.session.collected_json.time_preference).toBe('evening');
  });

  it('16. unavailable morning and afternoon are not offered', async () => {
    const sessionId = await createConversation(app, '+919222222313');
    await sendMessage(app, sessionId, 'Appointment venum', 'a02_tmr_1');
    await sendMessage(app, sessionId, 'Knee pain', 'a02_tmr_2');
    const step = await sendMessage(app, sessionId, 'tomorrow', 'a02_tmr_3');

    expect(['booking.propose_slots', 'booking.ask_time']).toContain(
      step.assistant_message.reply_template_key,
    );
    if (step.assistant_message.reply_template_key === 'booking.ask_time') {
      expect(step.assistant_message.message_text.toLowerCase()).not.toContain('morning');
      expect(step.assistant_message.message_text.toLowerCase()).not.toContain('afternoon');
    } else {
      expect(step.session.collected_json.time_preference).toBe('evening');
    }
  });

  it('17. alternate recovery rejects unavailable afternoon and accepts evening', async () => {
    const sessionId = await createConversation(app, '+919222222314');
    await sendMessage(app, sessionId, 'Appointment venum', 'a02_june_1');
    await sendMessage(app, sessionId, 'Knee pain', 'a02_june_2');
    await sendMessage(app, sessionId, '25-12-2026 evening', 'a02_june_3');

    const afternoonRetry = await sendMessage(app, sessionId, 'afternoon', 'a02_june_4');
    expect(afternoonRetry.assistant_message.reply_template_key).toBe('booking.ask_alternate_time');

    const eveningRetry = await sendMessage(
      app,
      sessionId,
      eveningRetryMessage(findNextBookableDate(TIMEZONE)),
      'a02_june_5',
    );
    expect(eveningRetry.session.collected_json.time_preference).toBe('evening');
    expect(eveningRetry.assistant_message.reply_template_key).toBe('booking.propose_slots');
  });

  it('18. acknowledgement after booking completes cleanly', async () => {
    const sessionId = await createConversation(app, '+919222222315');
    await sendMessage(app, sessionId, 'Naalaikku evening appointment venum', 'a02_help_0');
    await sendMessage(app, sessionId, 'Knee pain', 'a02_help_1');
    const slotStep = await sendMessage(app, sessionId, '6:30', 'a02_help_2');
    if (slotStep.assistant_message.reply_template_key === 'booking.propose_slots') {
      await sendMessage(app, sessionId, '6:30', 'a02_help_2b');
    }
    await sendMessage(app, sessionId, 'Kumar', 'a02_help_3');
    await sendMessage(app, sessionId, 'Seri', 'a02_help_4');

    const ack = await sendMessage(app, sessionId, 'okay', 'a02_help_5');
    expect(ack.assistant_message.reply_template_key).toBe('ack.okay_offer_help');
    expect(ack.session.current_flow).toBe('none');
    expect(ack.session.current_state).toBe('IDLE');
    expect(ack.session.status).toBe('completed');
  });

  it('19. acknowledgement then a new booking can start', async () => {
    const sessionId = await createConversation(app, '+919222222316');
    await sendMessage(app, sessionId, 'Naalaikku evening appointment venum', 'a02_help_yes_0');
    await sendMessage(app, sessionId, 'Knee pain', 'a02_help_yes_1');
    const slotStep = await sendMessage(app, sessionId, '6:30', 'a02_help_yes_2');
    if (slotStep.assistant_message.reply_template_key === 'booking.propose_slots') {
      await sendMessage(app, sessionId, '6:30', 'a02_help_yes_2b');
    }
    await sendMessage(app, sessionId, 'Kumar', 'a02_help_yes_3');
    await sendMessage(app, sessionId, 'Seri', 'a02_help_yes_4');

    const ack = await sendMessage(app, sessionId, 'okay', 'a02_help_yes_5');
    expect(ack.assistant_message.reply_template_key).toBe('ack.okay_offer_help');
    expect(ack.session.status).toBe('completed');

    const restart = await sendMessage(app, sessionId, 'Appointment venum', 'a02_help_yes_6');
    expect(restart.session.current_flow).toBe('booking');
    expect(restart.assistant_message.reply_template_key).toMatch(/booking\./);
  });
});
