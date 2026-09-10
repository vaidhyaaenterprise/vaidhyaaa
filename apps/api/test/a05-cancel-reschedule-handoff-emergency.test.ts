import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { addDays, dayOfWeekMon1, formatDateInTimezone } from '@vaidya/db';
import { apiSuccessBodySchema } from '@vaidya/shared';

import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';
import { SlotService } from '../src/modules/slots/slot.service';
import { slotHour } from '../src/modules/booking/booking-field-extractor';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';

const TIMEZONE = 'Asia/Kolkata';

function findBookableDate(timezone: string, minOffsetFromToday = 1): string {
  const today = formatDateInTimezone(new Date(), timezone);
  for (let offset = minOffsetFromToday; offset <= 14; offset += 1) {
    const candidate = addDays(today, offset, timezone);
    const dayOfWeek = dayOfWeekMon1(candidate, timezone);
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
      id: string;
      current_flow: string;
      current_state: string;
      collected_json: Record<string, unknown>;
      status: string;
    };
    assistant_message: { reply_template_key: string | null; message_text: string };
  };
}

const bookedSlotTimes = new Map<string, string>();

function eveningSlotTime(startTime: string): string {
  const timePart = startTime.includes(' ') ? (startTime.split(' ')[1] ?? startTime) : startTime;
  return timePart.slice(0, 5);
}

async function pickEveningSlotTime(
  app: NestFastifyApplication,
  phone: string,
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
  const index = Number(phone.replace(/\D/g, '').slice(-2)) % eveningSlots.length;
  return eveningSlotTime(eveningSlots[index]!.start_time);
}

function bookedSlotTimeForPhone(phone: string): string {
  const slotTime = bookedSlotTimes.get(phone);
  expect(slotTime).toBeTruthy();
  return slotTime!;
}

async function bookAppointmentForPhone(
  app: NestFastifyApplication,
  phone: string,
  bookingDate: string,
) {
  const slotTime = await pickEveningSlotTime(app, phone, bookingDate);
  bookedSlotTimes.set(phone, slotTime);

  const sessionId = await createConversation(app, phone);
  const step1 = await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, `${phone}_book_1`);
  expect([
    'booking.ask_problem_or_doctor',
    'booking.ask_reason',
    'booking.ask_date',
  ]).toContain(step1.assistant_message.reply_template_key);

  const step2 = await sendMessage(app, sessionId, 'Knee pain', `${phone}_book_2`);
  expect(step2.assistant_message.reply_template_key).toBe('booking.propose_slots');

  const step3 = await sendMessage(app, sessionId, slotTime, `${phone}_book_3`);
  expect(step3.assistant_message.reply_template_key).toBe('booking.ask_patient_name');

  const step4 = await sendMessage(app, sessionId, 'Kumar', `${phone}_book_4`);
  expect(step4.assistant_message.reply_template_key).toBe('booking.confirm_doctor');

  const step5 = await sendMessage(app, sessionId, 'Seri', `${phone}_book_5`);
  expect(step5.assistant_message.reply_template_key).toBe('booking.created_pending');

  return sessionId;
}

describe('A05 cancel, reschedule, handoff, and emergency', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let slotGeneration: SlotGenerationService;
  let bookingDate: string;
  let rescheduleDate: string;

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
      doctorId: SEED.DOCTOR_KUMAR_ID,
      clinicServiceId: SEED.ORTHO_SERVICE_ID,
    });

    bookingDate = findBookableDate(TIMEZONE, 1);
    rescheduleDate = findBookableDate(TIMEZONE, 4);
    if (rescheduleDate === bookingDate) {
      rescheduleDate = findBookableDate(TIMEZONE, 5);
    }

    await sql`
      UPDATE appointment_slots
      SET capacity_total = 10
      WHERE clinic_id = ${SEED.CLINIC_ID}
    `;
  });

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('1. cancel confirm directly cancels appointment and notifies admin', async () => {
    const phone = '+919222222501';
    await bookAppointmentForPhone(app, phone, bookingDate);

    const sessionId = await createConversation(app, phone);
    const step1 = await sendMessage(app, sessionId, 'Appointment cancel pannunga', 'a05_c_1');
    expect(step1.session.current_flow).toBe('cancel');
    expect(step1.assistant_message.reply_template_key).toBe('cancel.confirm');

    const step2 = await sendMessage(app, sessionId, 'Seri', 'a05_c_2');
    expect(step2.assistant_message.reply_template_key).toBe('cancel.completed');
    expect(step2.session.current_flow).toBe('none');

    const [appointment] = await sql`
      SELECT status FROM appointment_requests WHERE patient_phone = ${phone} LIMIT 1
    `;
    expect(appointment?.status).toBe('cancelled');

    const [actionRequest] = await sql`
      SELECT count(*)::int AS count FROM appointment_action_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(actionRequest?.count).toBe(0);

    const [notification] = await sql`
      SELECT event_type FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND payload_json->>'session_id' = ${sessionId}
    `;
    expect(notification?.event_type).toBe('appointment.cancelled');
  });

  it('2. cancel vendam creates no action request', async () => {
    const phone = '+919222222502';
    await bookAppointmentForPhone(app, phone, bookingDate);

    const sessionId = await createConversation(app, phone);
    await sendMessage(app, sessionId, 'Appointment cancel pannunga', 'a05_c2_1');
    const step2 = await sendMessage(app, sessionId, 'vendam', 'a05_c2_2');
    expect(step2.assistant_message.reply_template_key).toBe('cancel.not_cancelled');

    const actions = await sql`
      SELECT count(*)::int AS count FROM appointment_action_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(actions[0]?.count).toBe(0);
  });

  it('3. reschedule creates pending action request and holds new slot', async () => {
    const phone = '+919222222503';
    await bookAppointmentForPhone(app, phone, bookingDate);

    const sessionId = await createConversation(app, phone);
    const step1 = await sendMessage(
      app,
      sessionId,
      'Appointment time change panna venum',
      'a05_r_1',
    );
    expect(step1.session.current_flow).toBe('reschedule');
    expect(step1.assistant_message.reply_template_key).toBe('reschedule.ask_new_date');

    const step2 = await sendMessage(app, sessionId, rescheduleDate, 'a05_r_2');

    let slotProposalStep = step2;
    if (step2.assistant_message.reply_template_key === 'reschedule.ask_new_time') {
      slotProposalStep = await sendMessage(app, sessionId, 'evening', 'a05_r_3');
    }
    expect(slotProposalStep.assistant_message.reply_template_key).toBe('reschedule.propose_slots');

    const step4 = await sendMessage(app, sessionId, bookedSlotTimeForPhone(phone), 'a05_r_4');
    expect(step4.assistant_message.reply_template_key).toBe('reschedule.confirm');
    expect(step4.session.collected_json.hold_id).toBeTruthy();

    const step5 = await sendMessage(app, sessionId, 'Seri', 'a05_r_5');
    expect(step5.assistant_message.reply_template_key).toBe('reschedule.request_submitted');

    const [actionRequest] = await sql`
      SELECT request_type, status, requested_new_slot_id
      FROM appointment_action_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(actionRequest?.request_type).toBe('reschedule');
    expect(actionRequest?.status).toBe('pending');
    expect(actionRequest?.requested_new_slot_id).toBeTruthy();

    const [appointment] = await sql`
      SELECT status FROM appointment_requests WHERE patient_phone = ${phone} LIMIT 1
    `;
    expect(appointment?.status).toBe('pending_confirmation');
  });

  it('4. reschedule vendam releases hold and creates no action request', async () => {
    const phone = '+919222222504';
    await bookAppointmentForPhone(app, phone, bookingDate);

    const sessionId = await createConversation(app, phone);
    await sendMessage(app, sessionId, 'Appointment time change panna venum', 'a05_r2_1');
    const dateStep = await sendMessage(app, sessionId, rescheduleDate, 'a05_r2_2');
    if (dateStep.assistant_message.reply_template_key === 'reschedule.ask_new_time') {
      await sendMessage(app, sessionId, 'evening', 'a05_r2_3');
    }
    const step4 = await sendMessage(app, sessionId, bookedSlotTimeForPhone(phone), 'a05_r2_4');
    const holdId = step4.session.collected_json.hold_id as string;

    const step5 = await sendMessage(app, sessionId, 'vendam', 'a05_r2_5');
    expect(step5.assistant_message.reply_template_key).toBe('reschedule.not_changed');

    const [hold] = await sql`
      SELECT status FROM slot_holds WHERE id = ${holdId}
    `;
    expect(hold?.status).toBe('released');

    const actions = await sql`
      SELECT count(*)::int AS count FROM appointment_action_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(actions[0]?.count).toBe(0);
  });

  it('5. handoff creates callback_request after reason and name', async () => {
    const phone = '+919222222505';
    const sessionId = await createConversation(app, phone);

    const step1 = await sendMessage(app, sessionId, 'Receptionist kitta pesanum', 'a05_h_1');
    expect(step1.session.current_flow).toBe('handoff');
    expect(step1.assistant_message.reply_template_key).toBe('handoff.ask_reason');

    const step2 = await sendMessage(app, sessionId, 'Report pathi kekkanum', 'a05_h_2');
    expect(step2.assistant_message.reply_template_key).toBe('handoff.ask_name');

    const step3 = await sendMessage(app, sessionId, 'Kumar', 'a05_h_3');
    expect(step3.assistant_message.reply_template_key).toBe('handoff.created');
    expect(step3.session.status).toBe('completed');

    const [callback] = await sql`
      SELECT status, patient_phone, reason, patient_name
      FROM callback_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(callback?.status).toBe('pending');
    expect(callback?.patient_phone).toBe(phone);
    expect(callback?.reason).toContain('Report');
    expect(callback?.patient_name).toBe('Kumar');

    const [notification] = await sql`
      SELECT event_type FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'staff.callback_request'
        AND payload_json->>'session_id' = ${sessionId}
    `;
    expect(notification?.event_type).toBe('staff.callback_request');
  });

  it('6. handoff vendam creates no callback request', async () => {
    const phone = '+919222222506';
    const sessionId = await createConversation(app, phone);
    await sendMessage(app, sessionId, 'Receptionist kitta pesanum', 'a05_h2_1');
    const step2 = await sendMessage(app, sessionId, 'vendam', 'a05_h2_2');
    expect(step2.assistant_message.reply_template_key).toBe('handoff.cancelled');

    const callbacks = await sql`
      SELECT count(*)::int AS count FROM callback_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(callbacks[0]?.count).toBe(0);
  });

  it('7. emergency during cancel overrides and creates emergency_incident', async () => {
    const phone = '+919222222507';
    await bookAppointmentForPhone(app, phone, bookingDate);

    const sessionId = await createConversation(app, phone);
    await sendMessage(app, sessionId, 'Appointment cancel pannunga', 'a05_e_1');
    const step2 = await sendMessage(app, sessionId, 'Chest pain irukku', 'a05_e_2');
    expect(step2.assistant_message.reply_template_key).toBe('safety.emergency_active_flow');
    expect(step2.session.status).toBe('escalated');

    const actions = await sql`
      SELECT count(*)::int AS count FROM appointment_action_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(actions[0]?.count).toBe(0);

    const [incident] = await sql`
      SELECT status FROM emergency_incidents WHERE source_session_id = ${sessionId}
    `;
    expect(incident?.status).toBe('alert_created');

    const [notification] = await sql`
      SELECT event_type FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'staff.emergency_alert'
        AND payload_json->>'session_id' = ${sessionId}
    `;
    expect(notification?.event_type).toBe('staff.emergency_alert');
  });

  it('8. medical advice returns refusal without knowledge answer', async () => {
    const phone = '+919222222508';
    const sessionId = await createConversation(app, phone);
    const result = await sendMessage(app, sessionId, 'Fever-ku enna tablet edukkanum?', 'a05_m_1');
    expect(result.assistant_message.reply_template_key).toBe('safety.medical_advice_refusal');
    expect(result.assistant_message.message_text.toLowerCase()).not.toContain('parking');
  });

  it('9. repeated cancel intent after completion is idempotent', async () => {
    const phone = '+919222222509';
    await bookAppointmentForPhone(app, phone, bookingDate);

    const sessionId = await createConversation(app, phone);
    await sendMessage(app, sessionId, 'Appointment cancel pannunga', 'a05_idem_1');
    const step2 = await sendMessage(app, sessionId, 'Seri', 'a05_idem_2');
    expect(step2.assistant_message.reply_template_key).toBe('cancel.completed');
    const step3 = await sendMessage(app, sessionId, 'Appointment cancel pannunga', 'a05_idem_3');
    expect(step3.assistant_message.reply_template_key).toBe('cancel.completed');

    const [appointment] = await sql`
      SELECT status FROM appointment_requests WHERE patient_phone = ${phone} LIMIT 1
    `;
    expect(appointment?.status).toBe('cancelled');

    const notifications = await sql`
      SELECT count(*)::int AS count FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'appointment.cancelled'
        AND payload_json->>'session_id' = ${sessionId}
    `;
    expect(notifications[0]?.count).toBe(1);
  });

  it('10. reschedule after cancel finds no appointment', async () => {
    const phone = '+919222222510';
    await bookAppointmentForPhone(app, phone, bookingDate);

    const sessionId = await createConversation(app, phone);
    await sendMessage(app, sessionId, 'Appointment cancel pannunga', 'a05_rc_1');
    await sendMessage(app, sessionId, 'Seri', 'a05_rc_2');

    const step = await sendMessage(app, sessionId, 'Appointment time change panna venum', 'a05_rc_3');
    expect(step.assistant_message.reply_template_key).toBe('cancel.no_appointment_found');
    expect(step.session.current_flow).toBe('none');
  });

  it('11. symptom-only message starts booking flow', async () => {
    const phone = '+919222222511';
    const sessionId = await createConversation(app, phone);
    const step = await sendMessage(app, sessionId, 'Knee pain', 'a05_book_1');
    expect(step.session.current_flow).toBe('booking');
    expect(['booking.ask_problem_or_doctor', 'booking.ask_date', 'booking.propose_slots']).toContain(
      step.assistant_message.reply_template_key,
    );
  });

  it('12. handoff interrupts active booking', async () => {
    const phone = '+919222222512';
    const sessionId = await createConversation(app, phone);
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a05_hb_1');
    await sendMessage(app, sessionId, 'Knee pain', 'a05_hb_2');
    const step = await sendMessage(app, sessionId, 'Receptionist kitta pesanum', 'a05_hb_3');
    expect(step.session.current_flow).toBe('handoff');
    expect(['handoff.ask_reason', 'handoff.started_from_active_flow']).toContain(
      step.assistant_message.reply_template_key,
    );
  });

  it('14. handoff vendam during booking resumes propose slots', async () => {
    const phone = '+919222222514';
    const sessionId = await createConversation(app, phone);
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a05_hbr_1');
    await sendMessage(app, sessionId, 'Knee pain', 'a05_hbr_2');
    const propose = await sendMessage(app, sessionId, 'Receptionist kitta pesanum', 'a05_hbr_3');
    expect(propose.session.current_flow).toBe('handoff');

    const step = await sendMessage(app, sessionId, 'vendam', 'a05_hbr_4');
    expect(step.session.current_flow).toBe('booking');
    expect(step.session.current_state).toBe('PROPOSE_SLOTS');
    expect(step.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step.assistant_message.message_text.toLowerCase()).toContain('cancel');
    expect(step.assistant_message.message_text.toLowerCase()).toContain('choose');
    expect(step.session.collected_json.doctor_name).toBeTruthy();
    expect(
      Array.isArray(step.session.collected_json.proposed_slots)
        ? step.session.collected_json.proposed_slots.length
        : 0,
    ).toBeGreaterThan(0);
  });

  it('13. cancel works after booking thank_you in same session', async () => {
    const phone = '+919222222513';
    const bookSession = await bookAppointmentForPhone(app, phone, bookingDate);
    await sendMessage(app, bookSession, 'Okay', 'a05_post_1');
    await sendMessage(app, bookSession, 'Vendam', 'a05_post_2');

    const step = await sendMessage(app, bookSession, 'Appointment cancel pannunga', 'a05_post_3');
    expect(step.assistant_message.reply_template_key).toBe('cancel.confirm');
    expect(step.session.current_flow).toBe('cancel');
  });

  it('15. cancel confirm yes completes cancellation after booking without terminal ack', async () => {
    const phone = '+919222222515';
    const bookSession = await bookAppointmentForPhone(app, phone, bookingDate);

    const confirmStep = await sendMessage(app, bookSession, 'Appointment cancel pannunga', 'a05_cancel_yes_1');
    expect(confirmStep.assistant_message.reply_template_key).toBe('cancel.confirm');
    expect(confirmStep.session.current_flow).toBe('cancel');
    expect(confirmStep.session.current_state).toBe('CONFIRM_CANCEL_REQUEST');

    const doneStep = await sendMessage(app, bookSession, 'Seri', 'a05_cancel_yes_2');
    expect(doneStep.assistant_message.reply_template_key).toBe('cancel.completed');
    expect(doneStep.session.current_flow).toBe('none');

    const [appointment] = await sql`
      SELECT status FROM appointment_requests WHERE patient_phone = ${phone} LIMIT 1
    `;
    expect(appointment?.status).toBe('cancelled');

    const [notification] = await sql`
      SELECT event_type FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'appointment.cancelled'
        AND payload_json->>'session_id' = ${bookSession}
    `;
    expect(notification?.event_type).toBe('appointment.cancelled');
  });

  it('18. cancel confirm with Aama completes cancellation (Tanglish yes)', async () => {
    const phone = '+919222222518';
    const bookSession = await bookAppointmentForPhone(app, phone, bookingDate);

    await sendMessage(app, bookSession, 'Appointment cancel seiyanum', 'a05_cancel_aama_1');
    const confirmStep = await sendMessage(app, bookSession, 'Aama', 'a05_cancel_aama_2');
    expect(confirmStep.assistant_message.reply_template_key).toBe('cancel.completed');
    expect(confirmStep.session.current_state).toBe('DONE');

    const [appointment] = await sql`
      SELECT status FROM appointment_requests WHERE patient_phone = ${phone} LIMIT 1
    `;
    expect(appointment?.status).toBe('cancelled');
  });

  it('16. reschedule after booking asks for new date instead of jumping to confirm', async () => {
    const phone = '+919222222516';
    const bookSession = await bookAppointmentForPhone(app, phone, bookingDate);

    const step = await sendMessage(
      app,
      bookSession,
      'Appointment time change panna venum',
      'a05_reschedule_after_book_1',
    );
    expect(step.assistant_message.reply_template_key).toBe('reschedule.ask_new_date');
    expect(step.session.current_flow).toBe('reschedule');
    expect(step.session.current_state).toBe('ASK_NEW_DATE');
    expect(step.session.collected_json.selected_slot_id).toBeUndefined();
  });

  it('17. cancelling appointment rejects pending reschedule action requests', async () => {
    const phone = '+919222222517';
    await bookAppointmentForPhone(app, phone, bookingDate);

    const sessionId = await createConversation(app, phone);
    await sendMessage(app, sessionId, 'Appointment time change panna venum', 'a05_reject_1');
    const dateStep = await sendMessage(app, sessionId, rescheduleDate, 'a05_reject_2');
    if (dateStep.assistant_message.reply_template_key === 'reschedule.ask_new_time') {
      await sendMessage(app, sessionId, 'evening', 'a05_reject_3');
    }
    await sendMessage(app, sessionId, bookedSlotTimeForPhone(phone), 'a05_reject_4');
    await sendMessage(app, sessionId, 'Seri', 'a05_reject_5');

    const [pendingBefore] = await sql`
      SELECT status FROM appointment_action_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(pendingBefore?.status).toBe('pending');

    const cancelSessionId = await createConversation(app, phone);
    await sendMessage(app, cancelSessionId, 'Appointment cancel pannunga', 'a05_reject_6');
    await sendMessage(app, cancelSessionId, 'Seri', 'a05_reject_7');

    const [actionRequest] = await sql`
      SELECT status FROM appointment_action_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(actionRequest?.status).toBe('rejected');

    const [appointment] = await sql`
      SELECT status FROM appointment_requests WHERE patient_phone = ${phone} LIMIT 1
    `;
    expect(appointment?.status).toBe('cancelled');
  });
});
