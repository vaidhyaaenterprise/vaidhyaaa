import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  addDays,
  combineDateAndTime,
  formatClinicLocalTimestamp,
  formatDateInTimezone,
} from '@vaidya/db';
import { apiSuccessBodySchema } from '@vaidya/shared';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { devAuthHeaders, SEED } from './test-constants';

const TIMEZONE = 'Asia/Kolkata';
const HISTORY_PATIENT_PHONE = '+919700000082';
const HISTORY_PATIENT_PHONE_DIGITS = digitsOnly(HISTORY_PATIENT_PHONE);

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function buildSlotWindow(date: string, startTime: string, endTime: string) {
  const startDate = combineDateAndTime(date, startTime, TIMEZONE);
  const endDate = combineDateAndTime(date, endTime, TIMEZONE);
  return {
    startDate,
    endDate,
    startLocal: formatClinicLocalTimestamp(startDate, TIMEZONE),
    endLocal: formatClinicLocalTimestamp(endDate, TIMEZONE),
  };
}

describe('C08 web API to DB connectivity', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;

  const adminHeaders = devAuthHeaders({
    userId: SEED.CLINIC_ADMIN_ID,
    clinicId: SEED.CLINIC_ID,
    role: 'clinic_admin',
  });

  const platformHeaders = devAuthHeaders({
    userId: SEED.PLATFORM_ADMIN_ID,
    role: 'platform_admin',
    clinicId: SEED.CLINIC_ID,
  });

  let createdDoctorId = '';
  let createdServiceId = '';
  let createdMappingId = '';
  let createdHolidayId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/vaidya_test';
    await prepareTestDatabase();
    app = await createTestApp();
    sql = postgres(process.env.DATABASE_URL, { max: 1 });
  });

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('1. settings and users endpoints read/write clinic tables', async () => {
    const settingsResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/settings`,
      headers: adminHeaders,
    });

    expect(settingsResponse.statusCode).toBe(200);
    const settingsBody = apiSuccessBodySchema.parse(settingsResponse.json()).data as {
      settings: { clinic_id: string; fallback_phone: string | null };
    };
    expect(settingsBody.settings.clinic_id).toBe(SEED.CLINIC_ID);

    const fallbackPhone = '+919840099991';
    const patchSettingsResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/settings`,
      headers: adminHeaders,
      payload: { fallback_phone: fallbackPhone },
    });

    expect(patchSettingsResponse.statusCode).toBe(200);
    const [settingsRow] = await sql<{ fallback_phone: string | null }[]>`
      SELECT fallback_phone
      FROM clinic_settings
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
    `;
    expect(settingsRow?.fallback_phone).toBe(fallbackPhone);

    const usersResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users`,
      headers: adminHeaders,
    });

    expect(usersResponse.statusCode).toBe(200);
    const usersBody = apiSuccessBodySchema.parse(usersResponse.json()).data as {
      users: Array<{ id: string; role: string; active: boolean }>;
    };
    const doctorMembership = usersBody.users.find((row) => row.role === 'doctor');
    expect(doctorMembership).toBeTruthy();

    const disableResponse = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users/${doctorMembership!.id}/disable`,
      headers: adminHeaders,
    });

    expect(disableResponse.statusCode).toBe(201);
    const [disabledMembership] = await sql<{ active: boolean }[]>`
      SELECT active
      FROM clinic_users
      WHERE id = ${doctorMembership!.id}::uuid
    `;
    expect(disabledMembership?.active).toBe(false);

    const enableResponse = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users/${doctorMembership!.id}/enable`,
      headers: adminHeaders,
    });

    expect(enableResponse.statusCode).toBe(201);
    const [enabledMembership] = await sql<{ active: boolean }[]>`
      SELECT active
      FROM clinic_users
      WHERE id = ${doctorMembership!.id}::uuid
    `;
    expect(enabledMembership?.active).toBe(true);
  });

  it('2. doctors/services/mappings CRUD endpoints are DB-backed', async () => {
    const createDoctorResponse = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctors`,
      headers: adminHeaders,
      payload: {
        name: 'Dr. C08 Connectivity',
        qualification: 'MBBS',
      },
    });

    expect(createDoctorResponse.statusCode).toBe(201);
    const createDoctorBody = apiSuccessBodySchema.parse(createDoctorResponse.json()).data as {
      doctor: { id: string };
    };
    createdDoctorId = createDoctorBody.doctor.id;
    expect(createdDoctorId).toBeTruthy();

    const createServiceResponse = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/services`,
      headers: adminHeaders,
      payload: {
        service_name: 'Connectivity Service C08',
        service_key: 'connectivity_service_c08',
        active: true,
      },
    });

    expect(createServiceResponse.statusCode).toBe(201);
    const createServiceBody = apiSuccessBodySchema.parse(createServiceResponse.json()).data as {
      service: { id: string };
    };
    createdServiceId = createServiceBody.service.id;
    expect(createdServiceId).toBeTruthy();

    const createMappingResponse = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctor-services`,
      headers: adminHeaders,
      payload: {
        doctor_id: createdDoctorId,
        clinic_service_id: createdServiceId,
        consultation_fee_amount: 850,
        active: false,
      },
    });

    expect(createMappingResponse.statusCode).toBe(201);
    const createMappingBody = apiSuccessBodySchema.parse(createMappingResponse.json()).data as {
      doctor_service: { id: string };
    };
    createdMappingId = createMappingBody.doctor_service.id;
    expect(createdMappingId).toBeTruthy();

    const doctorsResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctors`,
      headers: adminHeaders,
    });
    expect(doctorsResponse.statusCode).toBe(200);
    const doctorsBody = apiSuccessBodySchema.parse(doctorsResponse.json()).data as {
      doctors: Array<{ id: string }>;
    };
    expect(doctorsBody.doctors.some((doctor) => doctor.id === createdDoctorId)).toBe(true);

    const servicesResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/services`,
      headers: adminHeaders,
    });
    expect(servicesResponse.statusCode).toBe(200);
    const servicesBody = apiSuccessBodySchema.parse(servicesResponse.json()).data as {
      services: Array<{ id: string }>;
    };
    expect(servicesBody.services.some((service) => service.id === createdServiceId)).toBe(true);

    const mappingsResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctor-services`,
      headers: adminHeaders,
    });
    expect(mappingsResponse.statusCode).toBe(200);
    const mappingsBody = apiSuccessBodySchema.parse(mappingsResponse.json()).data as {
      doctor_services: Array<{ id: string }>;
    };
    expect(mappingsBody.doctor_services.some((mapping) => mapping.id === createdMappingId)).toBe(true);

    const patchServiceResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/services/${createdServiceId}`,
      headers: adminHeaders,
      payload: { service_name: 'Connectivity Service C08 Updated' },
    });
    expect(patchServiceResponse.statusCode).toBe(200);

    const patchMappingResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctor-services/${createdMappingId}`,
      headers: adminHeaders,
      payload: { consultation_fee_amount: 900 },
    });
    expect(patchMappingResponse.statusCode).toBe(200);

    const [serviceRow] = await sql<{ service_name: string }[]>`
      SELECT service_name
      FROM clinic_services
      WHERE id = ${createdServiceId}::uuid
    `;
    expect(serviceRow?.service_name).toBe('Connectivity Service C08 Updated');

    const [mappingRow] = await sql<{ consultation_fee_amount: string | null }[]>`
      SELECT consultation_fee_amount::text AS consultation_fee_amount
      FROM doctor_services
      WHERE id = ${createdMappingId}::uuid
    `;
    expect(Number(mappingRow?.consultation_fee_amount ?? '0')).toBe(900);
  });

  it('3. hours/schedules and preview endpoints are DB-backed', async () => {
    const hoursResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/hours`,
      headers: adminHeaders,
    });
    expect(hoursResponse.statusCode).toBe(200);

    const previewHoursResponse = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/hours/preview`,
      headers: adminHeaders,
      payload: {
        windows: [
          {
            day_of_week: 1,
            start_time: '09:00',
            end_time: '11:00',
            active: true,
          },
        ],
      },
    });

    expect(previewHoursResponse.statusCode).toBe(201);
    const previewHoursBody = apiSuccessBodySchema.parse(previewHoursResponse.json()).data as {
      preview: { blocked: boolean; conflicts: unknown[] };
    };
    expect(typeof previewHoursBody.preview.blocked).toBe('boolean');
    expect(Array.isArray(previewHoursBody.preview.conflicts)).toBe(true);

    const replaceHoursResponse = await app.inject({
      method: 'PUT',
      url: `/v1/clinics/${SEED.CLINIC_ID}/hours`,
      headers: adminHeaders,
      payload: {
        windows: [
          {
            day_of_week: 1,
            start_time: '09:00',
            end_time: '11:00',
            active: true,
          },
        ],
      },
    });

    expect(replaceHoursResponse.statusCode).toBe(200);
    const [hoursCount] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM clinic_hours
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
        AND active = true
        AND day_of_week = 1
        AND start_time = '09:00'::time
        AND end_time = '11:00'::time
    `;
    expect(hoursCount?.count).toBeGreaterThan(0);

    const listSchedulesResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctors/${createdDoctorId}/schedules`,
      headers: adminHeaders,
    });
    expect(listSchedulesResponse.statusCode).toBe(200);

    const replaceSchedulesResponse = await app.inject({
      method: 'PUT',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctors/${createdDoctorId}/schedules`,
      headers: adminHeaders,
      payload: {
        windows: [
          {
            day_of_week: 2,
            start_time: '10:00',
            end_time: '12:00',
            active: true,
          },
        ],
      },
    });
    expect(replaceSchedulesResponse.statusCode).toBe(200);

    const schedulesResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctors/${createdDoctorId}/schedules`,
      headers: adminHeaders,
    });
    expect(schedulesResponse.statusCode).toBe(200);
    const schedulesBody = apiSuccessBodySchema.parse(schedulesResponse.json()).data as {
      schedules: Array<{ day_of_week: number }>;
    };
    expect(schedulesBody.schedules.some((schedule) => schedule.day_of_week === 2)).toBe(true);

    const [scheduleCount] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM doctor_schedules
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
        AND doctor_id = ${createdDoctorId}::uuid
        AND active = true
    `;
    expect(scheduleCount?.count).toBeGreaterThan(0);
  });

  it('4. holiday create/preview/patch/list endpoints are DB-backed', async () => {
    const today = formatDateInTimezone(new Date(), TIMEZONE);
    const holidayDate = addDays(today, 30, TIMEZONE);

    const previewHolidayResponse = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/holidays/preview`,
      headers: adminHeaders,
      payload: {
        holiday_date: holidayDate,
        is_full_day: true,
        doctor_ids: [SEED.DOCTOR_MURUGAN_ID],
      },
    });

    expect(previewHolidayResponse.statusCode).toBe(201);
    const previewHolidayBody = apiSuccessBodySchema.parse(previewHolidayResponse.json()).data as {
      preview: { blocked: boolean; conflicts: unknown[] };
    };
    expect(typeof previewHolidayBody.preview.blocked).toBe('boolean');
    expect(Array.isArray(previewHolidayBody.preview.conflicts)).toBe(true);

    const createHolidayResponse = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/holidays`,
      headers: adminHeaders,
      payload: {
        holiday_date: holidayDate,
        is_full_day: true,
        reason: 'C08 holiday',
        doctor_ids: [SEED.DOCTOR_MURUGAN_ID],
      },
    });

    expect(createHolidayResponse.statusCode).toBe(201);
    const createHolidayBody = apiSuccessBodySchema.parse(createHolidayResponse.json()).data as {
      holiday: { id: string };
    };
    createdHolidayId = createHolidayBody.holiday.id;
    expect(createdHolidayId).toBeTruthy();

    const patchHolidayResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/holidays/${createdHolidayId}`,
      headers: adminHeaders,
      payload: { reason: 'C08 holiday updated' },
    });

    expect(patchHolidayResponse.statusCode).toBe(200);

    const holidaysResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/holidays`,
      headers: adminHeaders,
    });

    expect(holidaysResponse.statusCode).toBe(200);
    const holidaysBody = apiSuccessBodySchema.parse(holidaysResponse.json()).data as {
      holidays: Array<{ id: string; doctor_ids: string[] }>;
    };
    const holiday = holidaysBody.holidays.find((row) => row.id === createdHolidayId);
    expect(holiday).toBeTruthy();
    expect(holiday?.doctor_ids).toContain(SEED.DOCTOR_MURUGAN_ID);

    const [holidayRow] = await sql<{ reason: string | null }[]>`
      SELECT reason
      FROM clinic_holidays
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
        AND id = ${createdHolidayId}::uuid
    `;
    expect(holidayRow?.reason).toBe('C08 holiday updated');

    const [holidayDoctorRow] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM clinic_holiday_doctors
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
        AND holiday_id = ${createdHolidayId}::uuid
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}::uuid
    `;
    expect(holidayDoctorRow?.count).toBe(1);
  });

  it('5. appointments list/lifecycle/action-request endpoints are DB-backed', async () => {
    const today = formatDateInTimezone(new Date(), TIMEZONE);
    const pendingDate = addDays(today, 7, TIMEZONE);
    const pendingWindow = buildSlotWindow(pendingDate, '18:00:00', '18:15:00');

    const [pendingSlot] = await sql<{ id: string }[]>`
      INSERT INTO appointment_slots (
        clinic_id,
        doctor_id,
        clinic_service_id,
        start_time,
        end_time,
        capacity_total,
        status,
        config_version
      )
      VALUES (
        ${SEED.CLINIC_ID},
        ${SEED.DOCTOR_MURUGAN_ID},
        ${SEED.GENERAL_SERVICE_ID},
        ${pendingWindow.startLocal}::timestamp,
        ${pendingWindow.endLocal}::timestamp,
        2,
        'open',
        1
      )
      RETURNING id
    `;
    expect(pendingSlot?.id).toBeTruthy();

    const availableSlotsResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/available-slots?doctor_id=${SEED.DOCTOR_MURUGAN_ID}&clinic_service_id=${SEED.GENERAL_SERVICE_ID}&date=${pendingDate}`,
      headers: adminHeaders,
    });

    expect(availableSlotsResponse.statusCode).toBe(200);
    const availableSlotsBody = apiSuccessBodySchema.parse(availableSlotsResponse.json()).data as {
      slots: Array<{ slot_id: string }>;
    };
    expect(availableSlotsBody.slots.some((slot) => slot.slot_id === pendingSlot?.id)).toBe(true);

    const createPendingAppointmentResponse = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments`,
      headers: adminHeaders,
      payload: {
        patient_name: 'C08 Pending Patient',
        patient_phone: '+919700000081',
        patient_age: 34,
        slot_id: pendingSlot?.id,
        doctor_id: SEED.DOCTOR_MURUGAN_ID,
        clinic_service_id: SEED.GENERAL_SERVICE_ID,
        reason_for_visit: 'Routine check',
        appointment_start: pendingWindow.startDate.toISOString(),
        appointment_end: pendingWindow.endDate.toISOString(),
        status: 'pending_confirmation',
      },
    });

    expect(createPendingAppointmentResponse.statusCode).toBe(201);
    const createPendingAppointmentBody = apiSuccessBodySchema.parse(
      createPendingAppointmentResponse.json(),
    ).data as {
      appointment: { id: string; status: string };
    };
    const pendingAppointmentId = createPendingAppointmentBody.appointment.id;
    expect(createPendingAppointmentBody.appointment.status).toBe('pending_confirmation');

    const listPendingAppointmentsResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments?status=pending_confirmation`,
      headers: adminHeaders,
    });

    expect(listPendingAppointmentsResponse.statusCode).toBe(200);
    const listPendingAppointmentsBody = apiSuccessBodySchema.parse(
      listPendingAppointmentsResponse.json(),
    ).data as {
      appointments: Array<{ id: string }>;
    };
    expect(
      listPendingAppointmentsBody.appointments.some(
        (appointment) => appointment.id === pendingAppointmentId,
      ),
    ).toBe(true);

    const confirmAppointmentResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/${pendingAppointmentId}/confirm`,
      headers: adminHeaders,
    });
    expect(confirmAppointmentResponse.statusCode).toBe(200);

    const [actionRequest] = await sql<{ id: string }[]>`
      INSERT INTO appointment_action_requests (
        clinic_id,
        appointment_id,
        request_type,
        requested_by,
        status,
        reason
      )
      VALUES (
        ${SEED.CLINIC_ID},
        ${pendingAppointmentId}::uuid,
        'cancel',
        'patient_call',
        'pending',
        'Need to change plan'
      )
      RETURNING id
    `;
    expect(actionRequest?.id).toBeTruthy();
    const actionRequestId = actionRequest!.id;

    const listActionRequestsResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/action-requests`,
      headers: adminHeaders,
    });

    expect(listActionRequestsResponse.statusCode).toBe(200);
    const listActionRequestsBody = apiSuccessBodySchema.parse(
      listActionRequestsResponse.json(),
    ).data as {
      action_requests: Array<{ id: string }>;
    };
    expect(
      listActionRequestsBody.action_requests.some((request) => request.id === actionRequest?.id),
    ).toBe(true);

    const rejectActionRequestResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/action-requests/${actionRequestId}`,
      headers: adminHeaders,
      payload: { status: 'rejected' },
    });

    expect(rejectActionRequestResponse.statusCode).toBe(200);
    const [actionRequestRow] = await sql<{ status: string }[]>`
      SELECT status
      FROM appointment_action_requests
      WHERE id = ${actionRequestId}::uuid
    `;
    expect(actionRequestRow?.status).toBe('rejected');

    const cancelAppointmentResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/${pendingAppointmentId}/cancel`,
      headers: adminHeaders,
    });
    expect(cancelAppointmentResponse.statusCode).toBe(200);

    const [cancelledAppointment] = await sql<{ status: string }[]>`
      SELECT status
      FROM appointment_requests
      WHERE id = ${pendingAppointmentId}::uuid
    `;
    expect(cancelledAppointment?.status).toBe('cancelled');

    const visitedDate = addDays(today, 8, TIMEZONE);
    const visitedWindow = buildSlotWindow(visitedDate, '19:00:00', '19:15:00');
    const [visitedSlot] = await sql<{ id: string }[]>`
      INSERT INTO appointment_slots (
        clinic_id,
        doctor_id,
        clinic_service_id,
        start_time,
        end_time,
        capacity_total,
        status,
        config_version
      )
      VALUES (
        ${SEED.CLINIC_ID},
        ${SEED.DOCTOR_MURUGAN_ID},
        ${SEED.GENERAL_SERVICE_ID},
        ${visitedWindow.startLocal}::timestamp,
        ${visitedWindow.endLocal}::timestamp,
        2,
        'open',
        1
      )
      RETURNING id
    `;
    expect(visitedSlot?.id).toBeTruthy();

    const createVisitedAppointmentResponse = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments`,
      headers: adminHeaders,
      payload: {
        patient_name: 'C08 History Patient',
        patient_phone: HISTORY_PATIENT_PHONE,
        patient_age: 41,
        slot_id: visitedSlot?.id,
        doctor_id: SEED.DOCTOR_MURUGAN_ID,
        clinic_service_id: SEED.GENERAL_SERVICE_ID,
        reason_for_visit: 'History follow-up',
        appointment_start: visitedWindow.startDate.toISOString(),
        appointment_end: visitedWindow.endDate.toISOString(),
        status: 'confirmed',
      },
    });

    expect(createVisitedAppointmentResponse.statusCode).toBe(201);
    const createVisitedAppointmentBody = apiSuccessBodySchema.parse(
      createVisitedAppointmentResponse.json(),
    ).data as {
      appointment: { id: string };
    };
    const visitedAppointmentId = createVisitedAppointmentBody.appointment.id;

    const markVisitedResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/${visitedAppointmentId}/mark-visited`,
      headers: adminHeaders,
      payload: {
        visit_reason: 'Follow-up completed',
        diagnosis: 'Resolved viral fever',
      },
    });

    expect(markVisitedResponse.statusCode).toBe(200);

    const [visitedAppointment] = await sql<{ status: string }[]>`
      SELECT status
      FROM appointment_requests
      WHERE id = ${visitedAppointmentId}::uuid
    `;
    expect(visitedAppointment?.status).toBe('visited');

    const [patientVisitRow] = await sql<{ id: string }[]>`
      SELECT id
      FROM patient_visits
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
        AND appointment_request_id = ${visitedAppointmentId}::uuid
      LIMIT 1
    `;
    expect(patientVisitRow?.id).toBeTruthy();
  });

  it('6. patient history endpoint returns DB-backed timeline data', async () => {
    const historyResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/patients/history?phone=${HISTORY_PATIENT_PHONE_DIGITS}`,
      headers: adminHeaders,
    });

    expect(historyResponse.statusCode).toBe(200);
    const historyBody = apiSuccessBodySchema.parse(historyResponse.json()).data as {
      patients: Array<{
        phone: string | null;
        history: Array<{ kind: 'visit' | 'appointment' }>;
      }>;
    };

    const patient = historyBody.patients.find(
      (row) => digitsOnly(row.phone ?? '') === HISTORY_PATIENT_PHONE_DIGITS,
    );
    expect(patient).toBeTruthy();
    expect(patient?.history.some((item) => item.kind === 'visit')).toBe(true);
  });

  it('7. calls and platform monitoring list endpoints are DB-backed', async () => {
    const [callRow] = await sql<{ id: string }[]>`
      INSERT INTO calls (
        clinic_id,
        patient_phone,
        started_at,
        ended_at,
        duration_seconds,
        outcome,
        summary
      )
      VALUES (
        ${SEED.CLINIC_ID},
        '+919700000083',
        now() - interval '2 minute',
        now() - interval '1 minute',
        60,
        'completed',
        'C08 connectivity call'
      )
      RETURNING id
    `;
    expect(callRow?.id).toBeTruthy();

    const callsResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/calls`,
      headers: adminHeaders,
    });

    expect(callsResponse.statusCode).toBe(200);
    const callsBody = apiSuccessBodySchema.parse(callsResponse.json()).data as {
      calls: Array<{ id: string }>;
    };
    expect(callsBody.calls.some((call) => call.id === callRow?.id)).toBe(true);

    const [notificationRow] = await sql<{ id: string }[]>`
      INSERT INTO notification_events (
        clinic_id,
        event_type,
        recipient_type,
        channel,
        status,
        payload_json,
        max_attempts
      )
      VALUES (
        ${SEED.CLINIC_ID},
        'appointment.confirmed',
        'patient',
        'whatsapp',
        'pending',
        ${JSON.stringify({ source: 'c08' })}::jsonb,
        3
      )
      RETURNING id
    `;
    expect(notificationRow?.id).toBeTruthy();

    const notificationsResponse = await app.inject({
      method: 'GET',
      url: '/internal/platform/notifications',
      headers: platformHeaders,
    });

    expect(notificationsResponse.statusCode).toBe(200);
    const notificationsBody = apiSuccessBodySchema.parse(notificationsResponse.json()).data as {
      notifications: Array<{ id: string }>;
    };
    expect(
      notificationsBody.notifications.some((notification) => notification.id === notificationRow?.id),
    ).toBe(true);

    const [jobRow] = await sql<{ id: string }[]>`
      INSERT INTO background_jobs (
        clinic_id,
        job_type,
        payload_json,
        status,
        priority,
        max_attempts
      )
      VALUES (
        ${SEED.CLINIC_ID},
        'c08.test.job',
        ${JSON.stringify({ source: 'c08' })}::jsonb,
        'pending',
        100,
        3
      )
      RETURNING id
    `;
    expect(jobRow?.id).toBeTruthy();

    const jobHealthResponse = await app.inject({
      method: 'GET',
      url: '/internal/platform/jobs/health',
      headers: platformHeaders,
    });

    expect(jobHealthResponse.statusCode).toBe(200);
    const jobHealthBody = apiSuccessBodySchema.parse(jobHealthResponse.json()).data as {
      health: Array<{ status: string; count: number }>;
      recent_runs: Array<{ id: string; status: string }>;
    };

    expect(
      jobHealthBody.health.some((row) => row.status === 'pending' && row.count >= 1),
    ).toBe(true);
    expect(jobHealthBody.recent_runs.some((row) => row.id === jobRow?.id)).toBe(true);
  });

  it('8. knowledge admin list endpoints are DB-backed', async () => {
    const [countRow] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM clinic_knowledge_base
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
    `;

    const listEntriesResponse = await app.inject({
      method: 'GET',
      url: '/v1/knowledge/entries',
      headers: adminHeaders,
    });

    expect(listEntriesResponse.statusCode).toBe(200);
    const listEntriesBody = apiSuccessBodySchema.parse(listEntriesResponse.json()).data as {
      entries: Array<{ id: string }>;
    };
    expect(listEntriesBody.entries.length).toBe(Number(countRow?.count ?? '0'));

    const embeddingStatusResponse = await app.inject({
      method: 'GET',
      url: '/v1/knowledge/embedding-status',
      headers: adminHeaders,
    });

    expect(embeddingStatusResponse.statusCode).toBe(200);
    const embeddingStatusBody = apiSuccessBodySchema.parse(embeddingStatusResponse.json()).data as {
      embedding_status: {
        approved_total: number;
        generated_count: number;
        pending_count: number;
      } | null;
    };
    expect(embeddingStatusBody.embedding_status).not.toBeNull();
    expect((embeddingStatusBody.embedding_status?.approved_total ?? -1) >= 0).toBe(true);
  });

  it('8a. knowledge endpoints are clinic-admin only', async () => {
    const entriesForbidden = await app.inject({
      method: 'GET',
      url: '/v1/knowledge/entries',
      headers: platformHeaders,
    });
    expect(entriesForbidden.statusCode).toBe(403);

    const manualTemplateForbidden = await app.inject({
      method: 'GET',
      url: '/v1/knowledge/manual-template',
      headers: platformHeaders,
    });
    expect(manualTemplateForbidden.statusCode).toBe(403);

    const embeddingStatusForbidden = await app.inject({
      method: 'GET',
      url: '/v1/knowledge/embedding-status',
      headers: platformHeaders,
    });
    expect(embeddingStatusForbidden.statusCode).toBe(403);
  });

  it('8b. manual template list and import endpoints are DB-backed', async () => {
    const listTemplateResponse = await app.inject({
      method: 'GET',
      url: '/v1/knowledge/manual-template',
      headers: adminHeaders,
    });

    expect(listTemplateResponse.statusCode).toBe(200);
    const listTemplateBody = apiSuccessBodySchema.parse(listTemplateResponse.json()).data as {
      template: {
        source: string;
        sections: Array<{
          key: string;
          title: string;
          questions: Array<{
            question: string;
            section_key: string | null;
            status: string;
            ui_status: 'draft' | 'approved' | 'inactive';
            exists: boolean;
            applicable: boolean;
            qa_approved: boolean;
          }>;
        }>;
        summary: {
          total: number;
          completed: number;
          approved: number;
          pending: number;
          not_applicable: number;
        };
      } | null;
    };

    expect(listTemplateBody.template).not.toBeNull();
    expect((listTemplateBody.template?.sections.length ?? 0) > 0).toBe(true);
    expect((listTemplateBody.template?.summary.total ?? 0) > 0).toBe(true);

    const firstSection = listTemplateBody.template?.sections[0];
    expect(firstSection).toBeTruthy();
    expect((firstSection?.questions.length ?? 0) > 0).toBe(true);

    const firstQuestion = firstSection?.questions[0];
    expect(firstQuestion).toBeTruthy();
    expect(firstQuestion?.section_key).toBe(firstSection?.key);
    expect(['draft', 'approved', 'inactive']).toContain(firstQuestion?.ui_status ?? 'draft');

    const importResponse = await app.inject({
      method: 'POST',
      url: '/v1/knowledge/manual-template/import',
      headers: adminHeaders,
    });

    expect(importResponse.statusCode).toBe(201);
    const importBody = apiSuccessBodySchema.parse(importResponse.json()).data as {
      result: { imported: number; existing: number };
    };
    expect(importBody.result.imported + importBody.result.existing).toBeGreaterThan(0);

    const secondImportResponse = await app.inject({
      method: 'POST',
      url: '/v1/knowledge/manual-template/import',
      headers: adminHeaders,
    });

    expect(secondImportResponse.statusCode).toBe(201);
    const secondImportBody = apiSuccessBodySchema.parse(secondImportResponse.json()).data as {
      result: { imported: number; existing: number };
    };
    expect(secondImportBody.result.imported).toBe(0);
    expect(secondImportBody.result.existing).toBeGreaterThan(0);
  });

  it('8c. manual template save & approve synchronously embeds question/answer into DB', async () => {
    const templateKey = 'c08-sync-embed::What are clinic reception hours?';
    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/knowledge/manual',
      headers: adminHeaders,
      payload: {
        template_key: templateKey,
        section_key: 'c08-sync-embed',
        question: 'What are clinic reception hours?',
        answer: 'Clinic reception opens at 9 AM on weekdays.',
        category: 'general',
        alternative_phrases_json: [],
        status: 'approved',
        qa_approved: true,
        applicable: true,
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const createBody = apiSuccessBodySchema.parse(createResponse.json()).data as {
      knowledge: { id: string; embedding_status: string | null; status: string };
    };
    expect(createBody.knowledge.status).toBe('approved');
    expect(createBody.knowledge.embedding_status).toBe('generated');

    const knowledgeId = createBody.knowledge.id;

    const [createdRow] = await sql<{
      embedding_status: string;
      question_embedding: unknown;
      answer_embedding: unknown;
      embedding: unknown;
      embedding_generated_at: Date | null;
      approved_at: Date | null;
    }[]>`
      SELECT
        embedding_status,
        question_embedding,
        answer_embedding,
        embedding,
        embedding_generated_at,
        approved_at
      FROM clinic_knowledge_base
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
        AND id = ${knowledgeId}::uuid
    `;

    expect(createdRow?.embedding_status).toBe('generated');
    expect(createdRow?.question_embedding).not.toBeNull();
    expect(createdRow?.answer_embedding).not.toBeNull();
    expect(createdRow?.embedding).not.toBeNull();
    expect(createdRow?.embedding_generated_at).not.toBeNull();
    expect(createdRow?.approved_at).not.toBeNull();

    const patchedAnswer = 'Clinic reception opens at 10 AM starting next month.';
    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/knowledge/${knowledgeId}`,
      headers: adminHeaders,
      payload: {
        clinic_id: SEED.CLINIC_ID,
        answer: patchedAnswer,
        status: 'approved',
        qa_approved: true,
      },
    });

    expect(patchResponse.statusCode).toBe(200);
    const patchBody = apiSuccessBodySchema.parse(patchResponse.json()).data as {
      knowledge: { id: string; status: string | null };
    };
    expect(patchBody.knowledge.id).toBe(knowledgeId);

    const [patchedRow] = await sql<{
      answer: string;
      embedding_status: string;
      question_embedding: unknown;
      answer_embedding: unknown;
      embedding_generated_at: Date | null;
      approved_at: Date | null;
    }[]>`
      SELECT
        answer,
        embedding_status,
        question_embedding,
        answer_embedding,
        embedding_generated_at,
        approved_at
      FROM clinic_knowledge_base
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
        AND id = ${knowledgeId}::uuid
    `;

    expect(patchedRow?.answer).toBe(patchedAnswer);
    expect(patchedRow?.embedding_status).toBe('generated');
    expect(patchedRow?.question_embedding).not.toBeNull();
    expect(patchedRow?.answer_embedding).not.toBeNull();
    expect(patchedRow?.embedding_generated_at).not.toBeNull();
    expect(patchedRow?.approved_at).not.toBeNull();

    const [queuedAudit] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM audit_logs
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
        AND entity_id = ${knowledgeId}::uuid
        AND event_type = 'knowledge_embedding_job_queued'
    `;
    expect(queuedAudit?.count ?? 0).toBe(0);
  });

  it('9. knowledge patch and embeddings-regenerate endpoints write to DB', async () => {
    const [knowledgeRow] = await sql<{ id: string; answer: string }[]>`
      SELECT id, answer
      FROM clinic_knowledge_base
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
        AND status = 'approved'
      ORDER BY created_at ASC
      LIMIT 1
    `;

    expect(knowledgeRow?.id).toBeTruthy();
    const knowledgeId = knowledgeRow!.id;
    const patchedAnswer = `${knowledgeRow!.answer} (C08 connectivity)`;

    const patchKnowledgeResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/knowledge/${knowledgeId}`,
      headers: adminHeaders,
      payload: {
        clinic_id: SEED.CLINIC_ID,
        answer: patchedAnswer,
      },
    });

    expect(patchKnowledgeResponse.statusCode).toBe(200);

    const [patchedKnowledgeRow] = await sql<{ answer: string }[]>`
      SELECT answer
      FROM clinic_knowledge_base
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
        AND id = ${knowledgeId}::uuid
    `;
    expect(patchedKnowledgeRow?.answer).toBe(patchedAnswer);

    const [queuedAuditBefore] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM audit_logs
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
        AND event_type = 'knowledge_embedding_job_queued'
    `;

    const regenerateResponse = await app.inject({
      method: 'POST',
      url: '/v1/knowledge/embeddings/regenerate',
      headers: adminHeaders,
      payload: {
        clinic_id: SEED.CLINIC_ID,
        only_status: 'approved',
      },
    });

    expect(regenerateResponse.statusCode).toBe(201);
    const regenerateBody = apiSuccessBodySchema.parse(regenerateResponse.json()).data as {
      queued: number;
    };
    expect(regenerateBody.queued).toBeGreaterThan(0);

    const [queuedAuditAfter] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM audit_logs
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
        AND event_type = 'knowledge_embedding_job_queued'
    `;
    expect((queuedAuditAfter?.count ?? 0) > (queuedAuditBefore?.count ?? 0)).toBe(true);
  });

  it('10. subscription, language, and platform change endpoints are DB-backed', async () => {
    const [currentSubscription] = await sql<{ plan_key: string; status: string }[]>`
      SELECT sp.plan_key, cs.status
      FROM clinic_subscriptions cs
      INNER JOIN subscription_plans sp ON sp.id = cs.subscription_plan_id
      WHERE cs.clinic_id = ${SEED.CLINIC_ID}::uuid
      LIMIT 1
    `;
    expect(currentSubscription).toBeTruthy();

    const subscriptionResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/subscription`,
      headers: adminHeaders,
    });

    expect(subscriptionResponse.statusCode).toBe(200);
    const subscriptionBody = apiSuccessBodySchema.parse(subscriptionResponse.json()).data as {
      subscription: { plan_key: string; status: string };
    };
    expect(subscriptionBody.subscription.plan_key).toBe(currentSubscription?.plan_key);
    expect(subscriptionBody.subscription.status).toBe(currentSubscription?.status);

    const billingMonth = `${new Date().toISOString().slice(0, 7)}-01`;
    await sql`
      INSERT INTO clinic_usage_monthly (clinic_id, billing_month, voice_call_count)
      VALUES (${SEED.CLINIC_ID}::uuid, ${billingMonth}::date, 42)
      ON CONFLICT (clinic_id, billing_month)
      DO UPDATE SET voice_call_count = EXCLUDED.voice_call_count, updated_at = now()
    `;

    const usageResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/usage/current-month`,
      headers: adminHeaders,
    });

    expect(usageResponse.statusCode).toBe(200);
    const usageBody = apiSuccessBodySchema.parse(usageResponse.json()).data as {
      usage: { voice_call_count: number; used_voice_minutes: number };
    };
    expect(usageBody.usage.voice_call_count).toBe(42);
    expect(usageBody.usage.used_voice_minutes).toBe(42);

    const languagesResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/languages`,
      headers: adminHeaders,
    });

    expect(languagesResponse.statusCode).toBe(200);

    const replaceLanguagesResponse = await app.inject({
      method: 'PUT',
      url: `/v1/clinics/${SEED.CLINIC_ID}/languages`,
      headers: adminHeaders,
      payload: {
        default_language_code: 'english',
        languages: [
          { language_code: 'english', enabled: true, is_default: true },
          { language_code: 'ta_tanglish', enabled: true, is_default: false },
        ],
      },
    });

    expect(replaceLanguagesResponse.statusCode).toBe(200);

    const languageRows = await sql<
      { language_code: string; enabled: boolean; is_default: boolean }[]
    >`
      SELECT language_code, enabled, is_default
      FROM clinic_languages
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
      ORDER BY language_code
    `;
    expect(languageRows.some((row) => row.language_code === 'english' && row.is_default)).toBe(true);
    expect(
      languageRows.some((row) => row.language_code === 'ta_tanglish' && row.enabled),
    ).toBe(true);

    const supportedLanguagesResponse = await app.inject({
      method: 'GET',
      url: '/v1/languages',
      headers: adminHeaders,
    });

    expect(supportedLanguagesResponse.statusCode).toBe(200);
    const supportedLanguagesBody = apiSuccessBodySchema.parse(supportedLanguagesResponse.json()).data as {
      languages: Array<{ language_code: string }>;
    };
    expect(supportedLanguagesBody.languages.some((row) => row.language_code === 'english')).toBe(true);

    const plansResponse = await app.inject({
      method: 'GET',
      url: '/internal/platform/subscription-plans',
      headers: platformHeaders,
    });

    expect(plansResponse.statusCode).toBe(200);
    const plansBody = apiSuccessBodySchema.parse(plansResponse.json()).data as {
      plans: Array<{ plan_key: string; active: boolean }>;
    };
    const targetPlan = plansBody.plans.find((row) => row.active) ?? plansBody.plans[0];
    expect(targetPlan?.plan_key).toBeTruthy();

    const changeSubscriptionResponse = await app.inject({
      method: 'POST',
      url: `/internal/platform/clinics/${SEED.CLINIC_ID}/subscription/change`,
      headers: platformHeaders,
      payload: {
        plan_key: targetPlan?.plan_key,
        status: 'manual_free',
        notes: 'C08 connectivity change',
      },
    });

    expect(changeSubscriptionResponse.statusCode).toBe(201);
    const [changedSubscription] = await sql<{ status: string; plan_key: string | null }[]>`
      SELECT
        status,
        plan_snapshot_json ->> 'plan_key' AS plan_key
      FROM clinic_subscriptions
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
      LIMIT 1
    `;
    expect(changedSubscription?.status).toBe('manual_free');
    expect(changedSubscription?.plan_key).toBe(targetPlan?.plan_key ?? null);
  });

  it('11. platform notification retry/cancel endpoints mutate notification status', async () => {
    const [failedEvent] = await sql<{ id: string }[]>`
      INSERT INTO notification_events (
        clinic_id,
        event_type,
        recipient_type,
        channel,
        status,
        recipient_phone,
        payload_json,
        max_attempts,
        attempt_count
      )
      VALUES (
        ${SEED.CLINIC_ID},
        'appointment.confirmed',
        'patient',
        'whatsapp',
        'failed',
        '+919700000084',
        ${JSON.stringify({ source: 'c08-retry' })}::jsonb,
        3,
        2
      )
      RETURNING id
    `;
    expect(failedEvent?.id).toBeTruthy();

    const retryResponse = await app.inject({
      method: 'POST',
      url: `/internal/platform/notifications/${failedEvent?.id}/retry`,
      headers: platformHeaders,
    });

    expect(retryResponse.statusCode).toBe(201);
    const failedEventId = failedEvent!.id;
    const [retriedEvent] = await sql<{ status: string }[]>`
      SELECT status
      FROM notification_events
      WHERE id = ${failedEventId}::uuid
    `;
    expect(retriedEvent?.status).toBe('pending');

    const [pendingEvent] = await sql<{ id: string }[]>`
      INSERT INTO notification_events (
        clinic_id,
        event_type,
        recipient_type,
        channel,
        status,
        recipient_phone,
        payload_json,
        max_attempts,
        attempt_count
      )
      VALUES (
        ${SEED.CLINIC_ID},
        'appointment.pending_confirmation',
        'patient',
        'whatsapp',
        'pending',
        '+919700000085',
        ${JSON.stringify({ source: 'c08-cancel' })}::jsonb,
        3,
        0
      )
      RETURNING id
    `;
    expect(pendingEvent?.id).toBeTruthy();

    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/internal/platform/notifications/${pendingEvent?.id}/cancel`,
      headers: platformHeaders,
    });

    expect(cancelResponse.statusCode).toBe(201);
    const pendingEventId = pendingEvent!.id;
    const [cancelledEvent] = await sql<{ status: string }[]>`
      SELECT status
      FROM notification_events
      WHERE id = ${pendingEventId}::uuid
    `;
    expect(cancelledEvent?.status).toBe('cancelled');
  });

  it('12. platform clinics list/onboarding/suspend/activate endpoints are DB-backed', async () => {
    const listClinicsResponse = await app.inject({
      method: 'GET',
      url: '/internal/platform/clinics',
      headers: platformHeaders,
    });

    expect(listClinicsResponse.statusCode).toBe(200);
    const listClinicsBody = apiSuccessBodySchema.parse(listClinicsResponse.json()).data as {
      clinics: Array<{ id: string }>;
    };
    expect(listClinicsBody.clinics.some((clinic) => clinic.id === SEED.CLINIC_ID)).toBe(true);

    const onboardingResponse = await app.inject({
      method: 'GET',
      url: `/internal/platform/clinics/${SEED.CLINIC_ID}/onboarding`,
      headers: platformHeaders,
    });

    expect(onboardingResponse.statusCode).toBe(200);
    const onboardingBody = apiSuccessBodySchema.parse(onboardingResponse.json()).data as {
      clinic: { id: string };
    };
    expect(onboardingBody.clinic.id).toBe(SEED.CLINIC_ID);

    const tempClinicId = '00000000-0000-0000-0000-00000000c801';
    await sql`
      INSERT INTO clinics (
        id,
        name,
        timezone,
        default_language_code,
        active,
        onboarding_status
      )
      VALUES (
        ${tempClinicId}::uuid,
        'C08 Platform Toggle Clinic',
        'Asia/Kolkata',
        'ta_tanglish',
        true,
        'setup_pending'
      )
      ON CONFLICT (id) DO NOTHING
    `;

    const suspendResponse = await app.inject({
      method: 'POST',
      url: `/internal/platform/clinics/${tempClinicId}/suspend`,
      headers: platformHeaders,
    });

    expect(suspendResponse.statusCode).toBe(201);
    const [suspendedClinic] = await sql<{ active: boolean }[]>`
      SELECT active
      FROM clinics
      WHERE id = ${tempClinicId}::uuid
    `;
    expect(suspendedClinic?.active).toBe(false);

    const activateResponse = await app.inject({
      method: 'POST',
      url: `/internal/platform/clinics/${tempClinicId}/activate`,
      headers: platformHeaders,
    });

    expect(activateResponse.statusCode).toBe(201);
    const [activatedClinic] = await sql<{ active: boolean }[]>`
      SELECT active
      FROM clinics
      WHERE id = ${tempClinicId}::uuid
    `;
    expect(activatedClinic?.active).toBe(true);
  });

  it('13. delete doctor-service/service/doctor endpoints mutate DB', async () => {
    expect(createdMappingId).toBeTruthy();
    expect(createdServiceId).toBeTruthy();
    expect(createdDoctorId).toBeTruthy();

    const deleteMappingResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctor-services/${createdMappingId}`,
      headers: adminHeaders,
    });
    expect(deleteMappingResponse.statusCode).toBe(200);

    const [mappingCount] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM doctor_services
      WHERE id = ${createdMappingId}::uuid
    `;
    expect(mappingCount?.count).toBe(0);

    const deleteServiceResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/clinics/${SEED.CLINIC_ID}/services/${createdServiceId}`,
      headers: adminHeaders,
    });
    expect(deleteServiceResponse.statusCode).toBe(200);

    const [serviceCount] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM clinic_services
      WHERE id = ${createdServiceId}::uuid
    `;
    expect(serviceCount?.count).toBe(0);

    const deleteDoctorResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctors/${createdDoctorId}`,
      headers: adminHeaders,
    });
    expect(deleteDoctorResponse.statusCode).toBe(200);

    const [doctorCount] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM doctors
      WHERE id = ${createdDoctorId}::uuid
    `;
    expect(doctorCount?.count).toBe(0);
  });
});
