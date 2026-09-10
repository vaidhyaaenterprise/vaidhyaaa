import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { apiErrorBodySchema, apiSuccessBodySchema } from '@vaidya/shared';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { devAuthHeaders, SEED } from './test-constants';

describe('C06 platform admin onboarding and user management', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let createdClinicId: string;
  let createdAdminUserId: string;
  let doctorWithoutLoginId: string;
  let doctorMembershipId: string;
  let doctorLoginUserId: string;

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

  it('1. platform admin can create clinic using nested onboarding payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/platform/clinics',
      headers: devAuthHeaders({
        userId: SEED.PLATFORM_ADMIN_ID,
        role: 'platform_admin',
      }),
      payload: {
        clinic: {
          name: 'C06 Nested Clinic',
          phone: '+919888888801',
          address_line1: 'Anna Nagar',
          city: 'Chennai',
          state: 'Tamil Nadu',
          country: 'India',
          timezone: 'Asia/Kolkata',
          default_language_code: 'ta_tanglish',
        },
        settings: {
          fallback_phone: '+919888888802',
          booking_mode: 'pending_confirmation',
          answering_mode: 'off',
          max_concurrent_calls: 1,
        },
        admin: {
          name: 'C06 Clinic Admin',
          email: 'c06-admin@example.com',
          phone: '+919888888803',
        },
        subscription: {
          plan_key: 'pilot',
          status: 'trialing',
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
    expect(data.clinic.name).toBe('C06 Nested Clinic');
  });

  it('2. clinic created with agent_enabled=false and expected defaults', async () => {
    const [settings] = await sql<
      {
        agent_enabled: boolean;
        answering_mode: string;
        booking_mode: string;
        fallback_phone: string | null;
        recording_retention_days: number;
        transcript_retention_days: number;
      }[]
    >`
      SELECT agent_enabled, answering_mode, booking_mode, fallback_phone,
             recording_retention_days, transcript_retention_days
      FROM clinic_settings
      WHERE clinic_id = ${createdClinicId}::uuid
    `;

    expect(settings?.agent_enabled).toBe(false);
    expect(settings?.answering_mode).toBe('off');
    expect(settings?.booking_mode).toBe('pending_confirmation');
    expect(settings?.fallback_phone).toBe('+919888888802');
    expect(settings?.recording_retention_days).toBe(10);
    expect(settings?.transcript_retention_days).toBe(30);
  });

  it('3. clinic languages include ta_tanglish default and english enabled', async () => {
    const languages = await sql<{ language_code: string; is_default: boolean; enabled: boolean }[]>`
      SELECT language_code, is_default, enabled
      FROM clinic_languages
      WHERE clinic_id = ${createdClinicId}::uuid
      ORDER BY language_code
    `;

    expect(languages.some((row) => row.language_code === 'ta_tanglish' && row.is_default)).toBe(true);
    expect(languages.some((row) => row.language_code === 'english' && row.enabled)).toBe(true);
  });

  it('4. first clinic admin membership and onboarding rows are created', async () => {
    const memberships = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM clinic_users
      WHERE clinic_id = ${createdClinicId}::uuid AND role = 'clinic_admin'
    `;
    expect(Number(memberships[0]?.count)).toBe(1);

    const [checklist] = await sql<{ admin_user_done: boolean }[]>`
      SELECT admin_user_done FROM clinic_onboarding_checklist
      WHERE clinic_id = ${createdClinicId}::uuid
    `;
    expect(checklist?.admin_user_done).toBe(true);

    const [subscription] = await sql<{ status: string }[]>`
      SELECT status FROM clinic_subscriptions WHERE clinic_id = ${createdClinicId}::uuid
    `;
    expect(subscription?.status).toBe('trialing');

    const audits = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM audit_logs
      WHERE clinic_id = ${createdClinicId}::uuid
        AND event_type = 'platform.clinic.created'
    `;
    expect(Number(audits[0]?.count)).toBe(1);
  });

  it('5. failed onboarding rolls back when subscription plan is invalid', async () => {
    const beforeCount = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM clinics WHERE name = 'C06 Rollback Clinic'
    `;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/platform/clinics',
      headers: devAuthHeaders({
        userId: SEED.PLATFORM_ADMIN_ID,
        role: 'platform_admin',
      }),
      payload: {
        name: 'C06 Rollback Clinic',
        admin: { name: 'Rollback Admin', email: 'rollback@example.com' },
        plan_key: 'does_not_exist',
      },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const afterCount = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM clinics WHERE name = 'C06 Rollback Clinic'
    `;
    expect(afterCount[0]?.count).toBe(beforeCount[0]?.count);
  });

  it('6. non-platform users cannot call internal platform API', async () => {
    const clinicAdminResponse = await app.inject({
      method: 'GET',
      url: '/internal/platform/clinics',
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });
    expect(clinicAdminResponse.statusCode).toBe(403);

    const doctorResponse = await app.inject({
      method: 'GET',
      url: '/internal/platform/clinics',
      headers: devAuthHeaders({
        userId: SEED.DOCTOR_PRIYA_USER_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'doctor',
        doctorId: SEED.DOCTOR_PRIYA_ID,
      }),
    });
    expect(doctorResponse.statusCode).toBe(403);
  });

  it('7. doctor profile can exist without user_id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${createdClinicId}/doctors`,
      headers: devAuthHeaders({
        userId: createdAdminUserId,
        clinicId: createdClinicId,
        role: 'clinic_admin',
      }),
      payload: {
        name: 'Dr. C06 No Login',
        qualification: 'MBBS',
      },
    });

    expect(response.statusCode).toBe(201);
    doctorWithoutLoginId = (apiSuccessBodySchema.parse(response.json()).data as {
      doctor: { id: string };
    }).doctor.id;

    const [doctor] = await sql<{ user_id: string | null }[]>`
      SELECT user_id FROM doctors WHERE id = ${doctorWithoutLoginId}::uuid
    `;
    expect(doctor?.user_id).toBeNull();
  });

  it('8. clinic admin can invite doctor login and link existing doctor_id', async () => {
    const inviteResponse = await app.inject({
      method: 'POST',
      url: '/v1/clinic/users/invite',
      headers: devAuthHeaders({
        userId: createdAdminUserId,
        clinicId: createdClinicId,
        role: 'clinic_admin',
      }),
      payload: {
        name: 'Dr. C06 No Login',
        email: 'dr-c06@example.com',
        phone: '+919888888804',
        role: 'doctor',
        doctor_id: doctorWithoutLoginId,
      },
    });

    expect(inviteResponse.statusCode).toBe(201);
    const inviteBody = apiSuccessBodySchema.parse(inviteResponse.json());
    doctorLoginUserId = (inviteBody.data as { user: { id: string } }).user.id;
    doctorMembershipId = (inviteBody.data as { membership: { id: string; doctor_id: string } })
      .membership.id;

    const [membership] = await sql<{ doctor_id: string; role: string }[]>`
      SELECT doctor_id, role FROM clinic_users WHERE id = ${doctorMembershipId}::uuid
    `;
    expect(membership?.role).toBe('doctor');
    expect(membership?.doctor_id).toBe(doctorWithoutLoginId);
  });

  it('9. disabled clinic_user cannot access clinic APIs', async () => {
    const disableResponse = await app.inject({
      method: 'POST',
      url: `/v1/clinic/users/${doctorMembershipId}/disable`,
      headers: devAuthHeaders({
        userId: createdAdminUserId,
        clinicId: createdClinicId,
        role: 'clinic_admin',
      }),
    });
    expect(disableResponse.statusCode).toBe(201);

    const forbiddenResponse = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${createdClinicId}/doctors`,
      headers: devAuthHeaders({
        userId: doctorLoginUserId,
        clinicId: createdClinicId,
        role: 'doctor',
        doctorId: doctorWithoutLoginId,
      }),
      payload: { name: 'Should Fail' },
    });
    expect(forbiddenResponse.statusCode).toBe(403);
  });

  it('10. disabling doctor profile sets doctors.active=false', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${createdClinicId}/doctors/${doctorWithoutLoginId}`,
      headers: devAuthHeaders({
        userId: createdAdminUserId,
        clinicId: createdClinicId,
        role: 'clinic_admin',
      }),
      payload: { active: false },
    });

    expect(response.statusCode).toBe(200);
    const [doctor] = await sql<{ active: boolean }[]>`
      SELECT active FROM doctors WHERE id = ${doctorWithoutLoginId}::uuid
    `;
    expect(doctor?.active).toBe(false);
  });

  it('11. agent enable fails if setup incomplete', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${createdClinicId}/settings`,
      headers: devAuthHeaders({
        userId: createdAdminUserId,
        clinicId: createdClinicId,
        role: 'clinic_admin',
      }),
      payload: { agent_enabled: true },
    });

    expect(response.statusCode).toBe(409);
    const body = apiErrorBodySchema.parse(response.json());
    expect(body.error.code).toBe('CLINIC_SETUP_INCOMPLETE');
  });

  it('12. agent enable succeeds after setup readiness is satisfied on seed clinic', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/settings`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
      payload: { agent_enabled: true },
    });

    expect(response.statusCode).toBe(200);
    const body = apiSuccessBodySchema.parse(response.json());
    expect((body.data as { settings: { agent_enabled: boolean } }).settings.agent_enabled).toBe(true);

    await sql`
      UPDATE clinic_settings SET agent_enabled = false
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
    `;
  });
});
