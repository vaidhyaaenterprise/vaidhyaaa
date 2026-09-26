import { NestFastifyApplication } from '@nestjs/platform-fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiErrorBodySchema, apiSuccessBodySchema } from '@vaidya/shared';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { devAuthHeaders, SEED } from './test-constants';

describe('clinic user credential management', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let clinicAdminMembershipId: string;
  let doctorMembershipId: string;
  let doctorUserId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/vaidya_test';
    await prepareTestDatabase();
    app = await createTestApp();
    sql = postgres(process.env.DATABASE_URL, { max: 1 });

    const [adminMembership] = await sql<{ id: string }[]>`
      SELECT id
      FROM clinic_users
      WHERE clinic_id = ${SEED.CLINIC_ID}::uuid
        AND user_id = ${SEED.CLINIC_ADMIN_ID}::uuid
    `;
    clinicAdminMembershipId = adminMembership!.id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (sql) {
      await sql.end({ timeout: 5 });
    }
  });

  it('lists both admin and doctor logins with the immutable clinic number', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });

    expect(response.statusCode).toBe(200);
    const data = apiSuccessBodySchema.parse(response.json()).data as {
      clinic_login_number: string;
      users: Array<{ role: string; user: { username: string | null } }>;
    };
    expect(data.clinic_login_number).toBe('1000');
    expect(data.users.some((entry) => entry.role === 'clinic_admin')).toBe(true);
    expect(data.users.some((entry) => entry.role === 'doctor')).toBe(true);
  });

  it('creates one doctor login with a normalized prefix and the doctor display name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
      payload: {
        role: 'doctor',
        doctor_id: SEED.DOCTOR_KUMAR_ID,
        login_name: '  Dr Kumar  ',
        password: 'initialPass12',
      },
    });

    expect(response.statusCode).toBe(201);
    const data = apiSuccessBodySchema.parse(response.json()).data as {
      user: { id: string; name: string; username: string };
      membership: { id: string };
    };
    expect(data.user.name).toBe('Dr. Kumar');
    expect(data.user.username).toBe('dr.kumar.1000');
    doctorUserId = data.user.id;
    doctorMembershipId = data.membership.id;

    const [doctor] = await sql<{ user_id: string | null }[]>`
      SELECT user_id FROM doctors WHERE id = ${SEED.DOCTOR_KUMAR_ID}::uuid
    `;
    expect(doctor?.user_id).toBe(doctorUserId);
  });

  it('returns a clear conflict for case-equivalent usernames and duplicate doctor links', async () => {
    const duplicateUsername = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
      payload: {
        role: 'clinic_admin',
        login_name: 'DR KUMAR',
        password: 'anotherPass12',
      },
    });
    expect(duplicateUsername.statusCode).toBe(409);
    expect(apiErrorBodySchema.parse(duplicateUsername.json()).error.code).toBe('CONFLICT');

    const duplicateDoctor = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
      payload: {
        role: 'doctor',
        doctor_id: SEED.DOCTOR_KUMAR_ID,
        login_name: 'kumar.second',
        password: 'anotherPass12',
      },
    });
    expect(duplicateDoctor.statusCode).toBe(409);
    expect(apiErrorBodySchema.parse(duplicateDoctor.json()).error.message).toContain(
      'already has a login',
    );
  });

  it('updates only the editable prefix and password', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users/${doctorMembershipId}`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
      payload: {
        login_name: 'Kumar Ortho',
        password: 'updatedPass12',
      },
    });

    expect(response.statusCode).toBe(200);
    const data = apiSuccessBodySchema.parse(response.json()).data as {
      user: { name: string; username: string };
    };
    expect(data.user.name).toBe('Dr. Kumar');
    expect(data.user.username).toBe('kumar.ortho.1000');

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'dr.kumar.1000', password: 'initialPass12' },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'KUMAR.ORTHO.1000', password: 'updatedPass12' },
    });
    expect(newLogin.statusCode).toBe(201);
  });

  it('prevents self-disable and protects the last active clinic admin across both routes', async () => {
    const selfDisable = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users/${clinicAdminMembershipId}/disable`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });
    expect(selfDisable.statusCode).toBe(403);

    const lastAdminDisable = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/members/${clinicAdminMembershipId}`,
      headers: devAuthHeaders({
        userId: SEED.PLATFORM_ADMIN_ID,
        role: 'platform_admin',
      }),
      payload: { active: false },
    });
    expect(lastAdminDisable.statusCode).toBe(409);
    expect(apiErrorBodySchema.parse(lastAdminDisable.json()).error.code).toBe('CONFLICT');
  });

  it('soft-revokes a login, unlinks its doctor, and keeps audit history', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users/${doctorMembershipId}`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });

    expect(response.statusCode).toBe(200);
    const data = apiSuccessBodySchema.parse(response.json()).data as {
      deleted: boolean;
      revoked: boolean;
      credentials_revoked: boolean;
    };
    expect(data).toMatchObject({
      deleted: true,
      revoked: true,
      credentials_revoked: true,
    });

    const [membership] = await sql<
      { active: boolean; deleted_at: Date | null; deleted_by_user_id: string | null }[]
    >`
      SELECT active, deleted_at, deleted_by_user_id
      FROM clinic_users
      WHERE id = ${doctorMembershipId}::uuid
    `;
    expect(membership?.active).toBe(false);
    expect(membership?.deleted_at).toBeTruthy();
    expect(membership?.deleted_by_user_id).toBe(SEED.CLINIC_ADMIN_ID);

    const [doctor] = await sql<{ user_id: string | null }[]>`
      SELECT user_id FROM doctors WHERE id = ${SEED.DOCTOR_KUMAR_ID}::uuid
    `;
    expect(doctor?.user_id).toBeNull();

    const [user] = await sql<
      { active: boolean; username: string | null; password_hash: string | null }[]
    >`
      SELECT active, username, password_hash FROM users WHERE id = ${doctorUserId}::uuid
    `;
    expect(user).toMatchObject({
      active: false,
      username: `revoked.${doctorUserId}`,
      password_hash: null,
    });

    const audits = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM audit_logs
      WHERE entity_id = ${doctorMembershipId}::uuid
        AND event_type = 'clinic.user.login_revoked'
    `;
    expect(Number(audits[0]?.count)).toBe(1);

    const listResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });
    const listed = apiSuccessBodySchema.parse(listResponse.json()).data as {
      users: Array<{ id: string }>;
    };
    expect(listed.users.some((entry) => entry.id === doctorMembershipId)).toBe(false);

    const revokedLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'kumar.ortho.1000', password: 'updatedPass12' },
    });
    expect(revokedLogin.statusCode).toBe(401);
  });

  it('allows the unlinked doctor and released username to receive a replacement login', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
      payload: {
        role: 'doctor',
        doctor_id: SEED.DOCTOR_KUMAR_ID,
        login_name: 'Kumar Ortho',
        password: 'replacementPass12',
      },
    });

    expect(response.statusCode).toBe(201);
    const data = apiSuccessBodySchema.parse(response.json()).data as {
      user: { username: string };
    };
    expect(data.user.username).toBe('kumar.ortho.1000');
  });

  it('prevents deleting the acting login and the last active clinic admin', async () => {
    const selfDelete = await app.inject({
      method: 'DELETE',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users/${clinicAdminMembershipId}`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });
    expect(selfDelete.statusCode).toBe(403);

    const lastAdminDelete = await app.inject({
      method: 'DELETE',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users/${clinicAdminMembershipId}`,
      headers: devAuthHeaders({
        userId: SEED.PLATFORM_ADMIN_ID,
        role: 'platform_admin',
      }),
    });
    expect(lastAdminDelete.statusCode).toBe(409);
  });

  it('revokes only the scoped membership when the user belongs to another clinic', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
      payload: {
        role: 'clinic_admin',
        login_name: 'Shared Admin',
        password: 'sharedAdmin12',
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = apiSuccessBodySchema.parse(createResponse.json()).data as {
      user: { id: string; username: string };
      membership: { id: string };
    };

    const otherClinicId = '00000000-0000-0000-0000-000000000099';
    await sql`
      INSERT INTO clinics (
        id, name, unique_number, timezone, default_language_code, active, onboarding_status
      )
      VALUES (
        ${otherClinicId}::uuid,
        'Shared User Safety Clinic',
        1999,
        'Asia/Kolkata',
        'english',
        true,
        'setup_pending'
      )
    `;
    await sql`
      INSERT INTO clinic_users (clinic_id, user_id, role, active)
      VALUES (${otherClinicId}::uuid, ${created.user.id}::uuid, 'clinic_admin', true)
    `;

    const unsafeEdit = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users/${created.membership.id}`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
      payload: { password: 'mustNotChange12' },
    });
    expect(unsafeEdit.statusCode).toBe(409);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users/${created.membership.id}`,
      headers: devAuthHeaders({
        userId: SEED.CLINIC_ADMIN_ID,
        clinicId: SEED.CLINIC_ID,
        role: 'clinic_admin',
      }),
    });
    expect(deleteResponse.statusCode).toBe(200);
    const deleted = apiSuccessBodySchema.parse(deleteResponse.json()).data as {
      credentials_revoked: boolean;
    };
    expect(deleted.credentials_revoked).toBe(false);

    const [preservedUser] = await sql<
      { active: boolean; username: string | null; password_hash: string | null }[]
    >`
      SELECT active, username, password_hash
      FROM users
      WHERE id = ${created.user.id}::uuid
    `;
    expect(preservedUser?.active).toBe(true);
    expect(preservedUser?.username).toBe('shared.admin.1000');
    expect(preservedUser?.password_hash).toBeTruthy();

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'SHARED.ADMIN.1000', password: 'sharedAdmin12' },
    });
    expect(loginResponse.statusCode).toBe(201);
  });
});
