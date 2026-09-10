import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { apiErrorBodySchema, apiSuccessBodySchema } from '@vaidya/shared';

import { prepareTestDatabase } from './db-setup';
import { devAuthHeaders, SEED } from './test-constants';
import { createTestApp } from './test-app';

describe('C02 auth, RBAC, and platform onboarding', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let createdClinicId: string;
  let createdAdminUserId: string;
  let doctorWithoutLoginId: string;
  let doctorLoginUserId: string;
  let doctorMembershipId: string;
  let appointmentForPriyaId: string;
  let appointmentForMuruganId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/vaidya_test';
    await prepareTestDatabase();
    app = await createTestApp();
    sql = postgres(process.env.DATABASE_URL, { max: 1 });
  });

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('1. platform admin can create clinic and initial settings', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/platform/clinics',
      headers: devAuthHeaders({
        userId: SEED.PLATFORM_ADMIN_ID,
        role: 'platform_admin',
      }),
      payload: {
        name: 'C02 Test Clinic',
        primary_phone: '+919999999901',
        city: 'Chennai',
        admin: {
          name: 'C02 Clinic Admin',
          email: 'c02-admin@example.com',
          phone: '+919999999902',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = apiSuccessBodySchema.parse(response.json());
    const data = body.data as {
      clinic: { id: string; name: string };
      admin_user: { id: string };
    };
    createdClinicId = data.clinic.id;
    createdAdminUserId = data.admin_user.id;
    expect(data.clinic.name).toBe('C02 Test Clinic');
  });

  it('2. newly created clinic has agent_enabled=false', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/platform/clinics/${createdClinicId}/onboarding`,
      headers: devAuthHeaders({
        userId: SEED.PLATFORM_ADMIN_ID,
        role: 'platform_admin',
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = apiSuccessBodySchema.parse(response.json());
    const settings = (body.data as { settings: { agent_enabled: boolean; answering_mode: string; booking_mode: string } }).settings;
    expect(settings.agent_enabled).toBe(false);
    expect(settings.answering_mode).toBe('off');
    expect(settings.booking_mode).toBe('pending_confirmation');
  });

  it('3. clinic admin membership is created', async () => {
    const memberships = await sql<{ id: string; role: string; user_id: string }[]>`
      SELECT id, role, user_id
      FROM clinic_users
      WHERE clinic_id = ${createdClinicId}::uuid AND role = 'clinic_admin'
    `;

    expect(memberships.length).toBe(1);
    expect(memberships[0]?.user_id).toBe(createdAdminUserId);
  });

  it('4. doctor profile can exist without user login', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${createdClinicId}/doctors`,
      headers: devAuthHeaders({
        userId: SEED.PLATFORM_ADMIN_ID,
        role: 'platform_admin',
      }),
      payload: {
        name: 'Dr. No Login',
        qualification: 'MBBS',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = apiSuccessBodySchema.parse(response.json());
    doctorWithoutLoginId = (body.data as { doctor: { id: string } }).doctor.id;

    const [doctor] = await sql<{ user_id: string | null }[]>`
      SELECT user_id FROM doctors WHERE id = ${doctorWithoutLoginId}::uuid
    `;
    expect(doctor?.user_id).toBeNull();
  });

  it('5. doctor login can be linked later through clinic_users.doctor_id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${createdClinicId}/doctors/${doctorWithoutLoginId}/link-login`,
      headers: devAuthHeaders({
        userId: SEED.PLATFORM_ADMIN_ID,
        role: 'platform_admin',
      }),
      payload: {
        name: 'Dr. No Login',
        email: 'dr-no-login@example.com',
        phone: '+919999999903',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = apiSuccessBodySchema.parse(response.json());
    doctorLoginUserId = (body.data as { user: { id: string } }).user.id;

    const [membership] = await sql<{ id: string; doctor_id: string; role: string }[]>`
      SELECT id, doctor_id, role
      FROM clinic_users
      WHERE clinic_id = ${createdClinicId}::uuid AND user_id = ${doctorLoginUserId}::uuid
    `;

    expect(membership?.role).toBe('doctor');
    expect(membership?.doctor_id).toBe(doctorWithoutLoginId);
    doctorMembershipId = membership!.id;
  });

  it('6. doctor cannot access another doctor appointment', async () => {
    const start = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 15 * 60 * 1000);

    const [slotPriya] = await sql<{ id: string }[]>`
      INSERT INTO appointment_slots (
        clinic_id, doctor_id, clinic_service_id, start_time, end_time, capacity_total, status
      )
      VALUES (
        ${SEED.CLINIC_ID}::uuid,
        ${SEED.DOCTOR_PRIYA_ID}::uuid,
        ${SEED.GENERAL_SERVICE_ID}::uuid,
        ${start.toISOString()}::timestamptz,
        ${end.toISOString()}::timestamptz,
        1,
        'open'
      )
      RETURNING id
    `;

    const [slotMurugan] = await sql<{ id: string }[]>`
      INSERT INTO appointment_slots (
        clinic_id, doctor_id, clinic_service_id, start_time, end_time, capacity_total, status
      )
      VALUES (
        ${SEED.CLINIC_ID}::uuid,
        ${SEED.DOCTOR_MURUGAN_ID}::uuid,
        ${SEED.GENERAL_SERVICE_ID}::uuid,
        ${start.toISOString()}::timestamptz,
        ${end.toISOString()}::timestamptz,
        1,
        'open'
      )
      RETURNING id
    `;

    const [appointmentPriya] = await sql<{ id: string }[]>`
      INSERT INTO appointment_requests (
        clinic_id, slot_id, patient_name, doctor_id, clinic_service_id,
        reason_for_visit, appointment_start, appointment_end, status
      )
      VALUES (
        ${SEED.CLINIC_ID}::uuid,
        ${slotPriya!.id}::uuid,
        'Patient A',
        ${SEED.DOCTOR_PRIYA_ID}::uuid,
        ${SEED.GENERAL_SERVICE_ID}::uuid,
        'Fever',
        ${start.toISOString()}::timestamptz,
        ${end.toISOString()}::timestamptz,
        'pending_confirmation'
      )
      RETURNING id
    `;

    const [appointmentMurugan] = await sql<{ id: string }[]>`
      INSERT INTO appointment_requests (
        clinic_id, slot_id, patient_name, doctor_id, clinic_service_id,
        reason_for_visit, appointment_start, appointment_end, status
      )
      VALUES (
        ${SEED.CLINIC_ID}::uuid,
        ${slotMurugan!.id}::uuid,
        'Patient B',
        ${SEED.DOCTOR_MURUGAN_ID}::uuid,
        ${SEED.GENERAL_SERVICE_ID}::uuid,
        'Back pain',
        ${start.toISOString()}::timestamptz,
        ${end.toISOString()}::timestamptz,
        'pending_confirmation'
      )
      RETURNING id
    `;

    appointmentForPriyaId = appointmentPriya!.id;
    appointmentForMuruganId = appointmentMurugan!.id;

    const ownResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/${appointmentForPriyaId}`,
      headers: devAuthHeaders({
        userId: SEED.DOCTOR_PRIYA_USER_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'doctor',
        doctorId: SEED.DOCTOR_PRIYA_ID,
      }),
    });
    expect(ownResponse.statusCode).toBe(200);

    const forbiddenResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/${appointmentForMuruganId}`,
      headers: devAuthHeaders({
        userId: SEED.DOCTOR_PRIYA_USER_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'doctor',
        doctorId: SEED.DOCTOR_PRIYA_ID,
      }),
    });

    expect(forbiddenResponse.statusCode).toBe(403);
    const errorBody = apiErrorBodySchema.parse(forbiddenResponse.json());
    expect(errorBody.error.code).toBe('DOCTOR_NOT_OWNER');
  });

  it('7. clinic admin can disable clinic user membership', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${createdClinicId}/members/${doctorMembershipId}`,
      headers: devAuthHeaders({
        userId: createdAdminUserId,
        clinicId: createdClinicId,
        role: 'clinic_admin',
      }),
      payload: { active: false },
    });

    expect(response.statusCode).toBe(200);
    const body = apiSuccessBodySchema.parse(response.json());
    expect((body.data as { membership: { active: boolean } }).membership.active).toBe(false);
  });

  it('8. disabled clinic user cannot access clinic APIs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${createdClinicId}/doctors`,
      headers: devAuthHeaders({
        userId: doctorLoginUserId,
        clinicId: createdClinicId,
        role: 'doctor',
        doctorId: doctorWithoutLoginId,
      }),
      payload: {
        name: 'Should Fail',
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('9. platform admin can globally disable a user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/internal/platform/users/${doctorLoginUserId}/disable`,
      headers: devAuthHeaders({
        userId: SEED.PLATFORM_ADMIN_ID,
        role: 'platform_admin',
      }),
      payload: { active: false },
    });

    expect(response.statusCode).toBe(201);
    const body = apiSuccessBodySchema.parse(response.json());
    expect((body.data as { user: { active: boolean } }).user.active).toBe(false);
  });

  it('10. normal clinic admin cannot call /internal/platform/*', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/platform/clinics',
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });

    expect(response.statusCode).toBe(403);
    const body = apiErrorBodySchema.parse(response.json());
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
