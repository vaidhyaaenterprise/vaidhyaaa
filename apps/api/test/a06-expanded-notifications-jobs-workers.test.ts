import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { addDays, dayOfWeekMon1, formatDateInTimezone } from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  apiSuccessBodySchema,
  JOB_TYPES,
  type JobRegistry,
} from '@vaidya/shared';

import { ConfigurableMockMessagingProvider } from '../src/common/adapters/mock-messaging.provider';
import { MockObjectStorageProvider } from '../src/common/adapters/mock-adapters';
import { JobExecutorService } from '../src/common/jobs/job-executor.service';
import { slotHour } from '../src/modules/booking/booking-field-extractor';
import { KnowledgeEmbeddingService } from '../src/modules/knowledge/knowledge-embedding.service';
import { KnowledgeUploadService } from '../src/modules/notification/background-job-handlers.service';
import { RecordingCleanupService } from '../src/modules/notification/recording-cleanup.service';
import { TranscriptCleanupService } from '../src/modules/notification/transcript-cleanup.service';
import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';
import { SlotService } from '../src/modules/slots/slot.service';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { devAuthHeaders, SEED } from './test-constants';

const TIMEZONE = 'Asia/Kolkata';

function waitForInlineJob(ms = 400): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, `${phone}_book_1`);
  await sendMessage(app, sessionId, 'Knee pain', `${phone}_book_2`);
  await sendMessage(app, sessionId, slotTime, `${phone}_book_3`);
  await sendMessage(app, sessionId, 'Kumar', `${phone}_book_4`);
  await sendMessage(app, sessionId, 'Seri', `${phone}_book_5`);

  return sessionId;
}

async function getAppointmentIdForPhone(sql: postgres.Sql, phone: string): Promise<string> {
  const [appointment] = await sql`
    SELECT id FROM appointment_requests
    WHERE clinic_id = ${SEED.CLINIC_ID}
      AND patient_phone = ${phone}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  expect(appointment?.id).toBeTruthy();
  return appointment!.id as string;
}

describe('A06 expanded notifications, jobs, and workers', () => {
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
    await sql`
      UPDATE clinic_settings
      SET notify_staff_on_pending_appointment = true,
          pending_appointment_notification_channel = 'whatsapp',
          booking_mode = 'pending_confirmation'
      WHERE clinic_id = ${SEED.CLINIC_ID}
    `;
  });

  beforeEach(() => {
    ConfigurableMockMessagingProvider.reset();
  });

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('1. patient confirmation notification only after admin confirms', async () => {
    const phone = '+919333333301';
    await bookAppointmentForPhone(app, phone, bookingDate);
    const appointmentId = await getAppointmentIdForPhone(sql, phone);

    const pendingPatientEvents = await sql`
      SELECT count(*)::int AS count FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND recipient_type = 'patient'
        AND event_type = 'appointment.confirmed'
        AND payload_json->>'appointment_id' = ${appointmentId}
    `;
    expect(pendingPatientEvents[0]?.count).toBe(0);

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/${appointmentId}/confirm`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });
    expect(response.statusCode).toBe(200);

    const [event] = await sql`
      SELECT status, event_type, recipient_type FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'appointment.confirmed'
        AND recipient_type = 'patient'
        AND payload_json->>'appointment_id' = ${appointmentId}
    `;
    expect(event?.event_type).toBe('appointment.confirmed');
    expect(event?.recipient_type).toBe('patient');

    await waitForInlineJob(1200);
    const [delivered] = await sql`
      SELECT status FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'appointment.confirmed'
        AND recipient_type = 'patient'
        AND payload_json->>'appointment_id' = ${appointmentId}
    `;
    expect(delivered?.status).toBe('sent');
    expect(ConfigurableMockMessagingProvider.sendAttempts).toBeGreaterThan(0);
  });

  it('2. optional staff notification on pending appointment respects clinic setting', async () => {
    const phoneEnabled = '+919333333302';
    await bookAppointmentForPhone(app, phoneEnabled, bookingDate);
    const appointmentEnabledId = await getAppointmentIdForPhone(sql, phoneEnabled);

    const [staffEvent] = await sql`
      SELECT event_type FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'staff.pending_appointment'
        AND payload_json->>'appointment_id' = ${appointmentEnabledId}
    `;
    expect(staffEvent?.event_type).toBe('staff.pending_appointment');

    const [patientEvent] = await sql`
      SELECT count(*)::int AS count FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND recipient_type = 'patient'
        AND event_type = 'appointment.confirmed'
        AND payload_json->>'appointment_id' = ${appointmentEnabledId}
    `;
    expect(patientEvent?.count).toBe(0);

    await sql`
      UPDATE clinic_settings
      SET notify_staff_on_pending_appointment = false
      WHERE clinic_id = ${SEED.CLINIC_ID}
    `;

    const phoneDisabled = '+919333333303';
    await bookAppointmentForPhone(app, phoneDisabled, bookingDate);
    const appointmentDisabledId = await getAppointmentIdForPhone(sql, phoneDisabled);

    const staffDisabled = await sql`
      SELECT count(*)::int AS count FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'staff.pending_appointment'
        AND payload_json->>'appointment_id' = ${appointmentDisabledId}
    `;
    expect(staffDisabled[0]?.count).toBe(0);

    const [appointment] = await sql`
      SELECT status FROM appointment_requests WHERE id = ${appointmentDisabledId}
    `;
    expect(appointment?.status).toBe('pending_confirmation');

    await sql`
      UPDATE clinic_settings
      SET notify_staff_on_pending_appointment = true
      WHERE clinic_id = ${SEED.CLINIC_ID}
    `;
  });

  it('3. admin reschedule creates appointment_event and patient time-changed notification', async () => {
    const phone = '+919333333304';
    await bookAppointmentForPhone(app, phone, bookingDate);
    const appointmentId = await getAppointmentIdForPhone(sql, phone);

    await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/${appointmentId}/confirm`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });

    const slotService = app.get(SlotService);
    const slots = await slotService.findAvailableSlots(
      SEED.CLINIC_ID,
      SEED.DOCTOR_KUMAR_ID,
      SEED.ORTHO_SERVICE_ID,
    );
    const newSlot = slots.find((slot) => slot.start_time.startsWith(rescheduleDate));
    expect(newSlot).toBeTruthy();

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/${appointmentId}/reschedule`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
      payload: { new_slot_id: newSlot!.slot_id },
    });
    expect(response.statusCode).toBe(200);

    const [appointmentEvent] = await sql`
      SELECT event_type FROM appointment_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND appointment_request_id = ${appointmentId}
        AND event_type = 'appointment.rescheduled'
    `;
    expect(appointmentEvent?.event_type).toBe('appointment.rescheduled');

    const [notification] = await sql`
      SELECT event_type FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'appointment.rescheduled'
        AND recipient_type = 'patient'
        AND payload_json->>'appointment_id' = ${appointmentId}
    `;
    expect(notification?.event_type).toBe('appointment.rescheduled');

    await waitForInlineJob(800);
    expect(ConfigurableMockMessagingProvider.sendAttempts).toBeGreaterThan(0);
  });

  it('4. admin cancel creates appointment_event and patient cancellation notification', async () => {
    const phone = '+919333333305';
    await bookAppointmentForPhone(app, phone, bookingDate);
    const appointmentId = await getAppointmentIdForPhone(sql, phone);

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/${appointmentId}/cancel`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });
    expect(response.statusCode).toBe(200);

    const [appointment] = await sql`
      SELECT status FROM appointment_requests WHERE id = ${appointmentId}
    `;
    expect(appointment?.status).toBe('cancelled');

    const [appointmentEvent] = await sql`
      SELECT event_type FROM appointment_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND appointment_request_id = ${appointmentId}
        AND event_type = 'appointment.cancelled'
    `;
    expect(appointmentEvent?.event_type).toBe('appointment.cancelled');

    const [notification] = await sql`
      SELECT event_type FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'appointment.cancelled'
        AND recipient_type = 'patient'
        AND payload_json->>'appointment_id' = ${appointmentId}
    `;
    expect(notification?.event_type).toBe('appointment.cancelled');

    await waitForInlineJob(800);
    expect(ConfigurableMockMessagingProvider.sendAttempts).toBeGreaterThan(0);
  });

  it('5. emergency alert creates high-priority staff notification', async () => {
    const phone = '+919333333306';
    const sessionId = await createConversation(app, phone);
    const result = await sendMessage(app, sessionId, 'Chest pain irukku', 'a06_emergency_1');
    expect(result.assistant_message.reply_template_key).toBe('safety.emergency');

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

    await waitForInlineJob(800);
    expect(ConfigurableMockMessagingProvider.sendAttempts).toBeGreaterThan(0);
  });

  it('6. callback request creates admin notification', async () => {
    const phone = '+919333333307';
    const sessionId = await createConversation(app, phone);
    await sendMessage(app, sessionId, 'Receptionist kitta pesanum', 'a06_callback_1');
    await sendMessage(app, sessionId, 'Report pathi kekkanum', 'a06_callback_2');
    await sendMessage(app, sessionId, 'Kumar', 'a06_callback_3');

    const [callback] = await sql`
      SELECT status FROM callback_requests WHERE source_session_id = ${sessionId}
    `;
    expect(callback?.status).toBe('pending');

    const [notification] = await sql`
      SELECT event_type FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'staff.callback_request'
        AND payload_json->>'session_id' = ${sessionId}
    `;
    expect(notification?.event_type).toBe('staff.callback_request');
  });

  it('7. patient cancel and reschedule requests notify admin', async () => {
    const cancelPhone = '+919333333308';
    await bookAppointmentForPhone(app, cancelPhone, bookingDate);
    const cancelSessionId = await createConversation(app, cancelPhone);
    await sendMessage(app, cancelSessionId, 'Appointment cancel pannunga', 'a06_cancel_req_1');
    await sendMessage(app, cancelSessionId, 'Seri', 'a06_cancel_req_2');

    const [cancelNotification] = await sql`
      SELECT event_type FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND payload_json->>'session_id' = ${cancelSessionId}
    `;
    expect(cancelNotification?.event_type).toBe('appointment.cancelled');

    const reschedulePhone = '+919333333309';
    await bookAppointmentForPhone(app, reschedulePhone, bookingDate);
    const rescheduleSessionId = await createConversation(app, reschedulePhone);
    await sendMessage(
      app,
      rescheduleSessionId,
      'Appointment time change panna venum',
      'a06_reschedule_req_1',
    );
    const dateStep = await sendMessage(app, rescheduleSessionId, rescheduleDate, 'a06_reschedule_req_2');
    if (dateStep.assistant_message.reply_template_key === 'reschedule.ask_new_time') {
      await sendMessage(app, rescheduleSessionId, 'evening', 'a06_reschedule_req_3');
    }
    await sendMessage(
      app,
      rescheduleSessionId,
      bookedSlotTimeForPhone(reschedulePhone),
      'a06_reschedule_req_4',
    );
    await sendMessage(app, rescheduleSessionId, 'Seri', 'a06_reschedule_req_5');

    const [actionRequest] = await sql`
      SELECT request_type, status FROM appointment_action_requests
      WHERE source_session_id = ${rescheduleSessionId}
    `;
    expect(actionRequest?.request_type).toBe('reschedule');
    expect(actionRequest?.status).toBe('pending');

    const [rescheduleNotification] = await sql`
      SELECT event_type FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'staff.action_request'
        AND payload_json->>'session_id' = ${rescheduleSessionId}
    `;
    expect(rescheduleNotification?.event_type).toBe('staff.action_request');
  });

  it('8. provider failure retries and eventually marks notification sent', async () => {
    await sql`
      UPDATE clinic_settings
      SET notify_staff_on_pending_appointment = false
      WHERE clinic_id = ${SEED.CLINIC_ID}
    `;
    ConfigurableMockMessagingProvider.failUntilAttempt = 2;

    const phone = '+919333333310';
    await bookAppointmentForPhone(app, phone, bookingDate);
    const appointmentId = await getAppointmentIdForPhone(sql, phone);

    ConfigurableMockMessagingProvider.sendAttempts = 0;

    await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/${appointmentId}/confirm`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });

    await waitForInlineJob(2000);

    const events = await sql`
      SELECT count(*)::int AS count FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'appointment.confirmed'
        AND recipient_type = 'patient'
        AND payload_json->>'appointment_id' = ${appointmentId}
    `;
    expect(events[0]?.count).toBe(1);

    const [delivered] = await sql`
      SELECT status, attempt_count FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'appointment.confirmed'
        AND recipient_type = 'patient'
        AND payload_json->>'appointment_id' = ${appointmentId}
    `;
    expect(delivered?.status).toBe('sent');
    expect(ConfigurableMockMessagingProvider.sendAttempts).toBe(3);

    await sql`
      UPDATE clinic_settings
      SET notify_staff_on_pending_appointment = true
      WHERE clinic_id = ${SEED.CLINIC_ID}
    `;
  });

  it('9. provider permanent failure marks event failed without crashing worker', async () => {
    ConfigurableMockMessagingProvider.alwaysFail = true;

    const phone = '+919333333311';
    await bookAppointmentForPhone(app, phone, bookingDate);
    const appointmentId = await getAppointmentIdForPhone(sql, phone);

    await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/${appointmentId}/confirm`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });

    await waitForInlineJob(2500);

    const [failed] = await sql`
      SELECT status, last_error, attempt_count FROM notification_events
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND event_type = 'appointment.confirmed'
        AND recipient_type = 'patient'
        AND payload_json->>'appointment_id' = ${appointmentId}
    `;
    expect(failed?.status).toBe('failed');
    expect(failed?.last_error).toContain('mock_messaging_provider_failure');
    expect(failed?.attempt_count).toBe(3);

    const registry = app.get<JobRegistry>(ADAPTER_TOKENS.JobRegistry);
    expect(registry.getHandler(JOB_TYPES.SEND_NOTIFICATION)).toBeTypeOf('function');
  });

  it('10. recording cleanup deletes expired mock object and updates DB', async () => {
    const deleteSpy = vi.spyOn(MockObjectStorageProvider.prototype, 'delete');

    const [call] = await sql`
      INSERT INTO calls (
        clinic_id, patient_phone, recording_url, recording_storage_key, recording_expires_at
      ) VALUES (
        ${SEED.CLINIC_ID},
        '+919333333312',
        'https://mock-storage.local/recording.mp3',
        'recordings/expired-call.mp3',
        now() - interval '1 day'
      )
      RETURNING id
    `;

    const cleanup = app.get(RecordingCleanupService);
    const result = await cleanup.cleanupExpiredRecordings({ clinicId: SEED.CLINIC_ID });
    expect(result.deleted).toBeGreaterThan(0);
    expect(deleteSpy).toHaveBeenCalledWith('recordings/expired-call.mp3');

    const [updated] = await sql`
      SELECT recording_deleted_at, recording_url FROM calls WHERE id = ${call!.id}
    `;
    expect(updated?.recording_deleted_at).toBeTruthy();
    expect(updated?.recording_url).toBeNull();

    deleteSpy.mockRestore();
  });

  it('11. transcript cleanup redacts old transcript text', async () => {
    const [call] = await sql`
      INSERT INTO calls (clinic_id, patient_phone)
      VALUES (${SEED.CLINIC_ID}, '+919333333313')
      RETURNING id
    `;

    const [transcript] = await sql`
      INSERT INTO call_transcripts (clinic_id, call_id, speaker, transcript_text, created_at)
      VALUES (
        ${SEED.CLINIC_ID},
        ${call!.id},
        'patient',
        'Sensitive transcript text',
        now() - interval '45 days'
      )
      RETURNING id
    `;

    const cleanup = app.get(TranscriptCleanupService);
    const result = await cleanup.cleanupExpiredTranscripts({ clinicId: SEED.CLINIC_ID });
    expect(result.redacted).toBeGreaterThan(0);

    const [updated] = await sql`
      SELECT transcript_text FROM call_transcripts WHERE id = ${transcript!.id}
    `;
    expect(updated?.transcript_text).toBe('[redacted]');

    const [callRow] = await sql`
      SELECT id FROM calls WHERE id = ${call!.id}
    `;
    expect(callRow?.id).toBe(call!.id);
  });

  it('12. DOCX parsing job inserts pending_review Q&A rows only', async () => {
    const uploadService = app.get(KnowledgeUploadService);
    const file = await uploadService.uploadKnowledgeDocx({
      clinicId: SEED.CLINIC_ID,
      fileName: 'clinic-faq.docx',
      uploadedByUserId: SEED.CLINIC_ADMIN_ID,
    });

    await waitForInlineJob(800);

    const [knowledgeFile] = await sql`
      SELECT status FROM knowledge_files
      WHERE clinic_id = ${SEED.CLINIC_ID} AND id = ${file.id}
    `;
    expect(knowledgeFile?.status).toBe('processed');

    const entries = await sql`
      SELECT status, question FROM clinic_knowledge_base
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND source_file_id = ${file.id}
    `;
    expect(entries.length).toBe(2);
    expect(entries.every((entry) => entry.status === 'pending_review')).toBe(true);
  });

  it('13. embedding job generates mock embedding for approved knowledge', async () => {
    const embeddingService = app.get(KnowledgeEmbeddingService);
    const uploadService = app.get(KnowledgeUploadService);
    const executor = app.get(JobExecutorService);

    const [seedEntry] = await sql`
      SELECT id FROM clinic_knowledge_base
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND status = 'approved'
      LIMIT 1
    `;

    const result = await embeddingService.generateEmbedding(
      SEED.CLINIC_ID,
      seedEntry!.id as string,
    );
    expect(['generated', 'skipped']).toContain(result.status);

    await expect(
      executor.runValidatedJob(
        JOB_TYPES.GENERATE_KNOWLEDGE_EMBEDDING,
        'embeddings',
        {
          clinic_id: SEED.CLINIC_ID,
          knowledge_entry_id: seedEntry!.id as string,
        },
      ),
    ).resolves.toBeUndefined();

    const file = await uploadService.uploadKnowledgeDocx({
      clinicId: SEED.CLINIC_ID,
      fileName: 'embedding-test.docx',
    });
    await waitForInlineJob(800);

    const [entry] = await sql`
      SELECT id FROM clinic_knowledge_base
      WHERE clinic_id = ${SEED.CLINIC_ID}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(entry?.id).toBeTruthy();

    await expect(
      uploadService.enqueueEmbeddingJob(SEED.CLINIC_ID, entry!.id as string),
    ).resolves.toBeUndefined();
    await waitForInlineJob(400);

    expect(file.id).toBeTruthy();
  });
});
