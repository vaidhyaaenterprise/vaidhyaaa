import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiErrorBodySchema, apiSuccessBodySchema } from '@vaidya/shared';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';

type ClinicContext = {
  clinic_id: string;
  role: 'clinic_admin' | 'doctor';
  doctor_id: string | null;
  active: boolean;
};

type LoginData = {
  access_token: string;
  user: { id: string };
  clinics: ClinicContext[];
};

function bearerHeaders(accessToken: string): { authorization: string } {
  return { authorization: `Bearer ${accessToken}` };
}

describe('clinic login provisioning with JWT authentication', () => {
  let app: NestFastifyApplication;
  let previousAuthMode: string | undefined;

  beforeAll(async () => {
    previousAuthMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = 'jwt';
    await prepareTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    try {
      if (app) {
        await app.close();
      }
      await prepareTestDatabase();
    } finally {
      if (previousAuthMode === undefined) {
        delete process.env.AUTH_MODE;
      } else {
        process.env.AUTH_MODE = previousAuthMode;
      }
    }
  });

  it('provisions a fresh doctor and admin login that both authenticate with the correct context', async () => {
    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/v1/me',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const otpRequest = await app.inject({
      method: 'POST',
      url: '/v1/auth/request-otp',
      payload: { identifier: 'admin@sri-murugan.local' },
    });
    expect(otpRequest.statusCode).toBe(201);
    const otpRequestData = apiSuccessBodySchema.parse(otpRequest.json()).data as {
      challenge_id: string;
    };

    const otpVerification = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-otp',
      payload: {
        challenge_id: otpRequestData.challenge_id,
        otp: '000000',
        clinic_id: SEED.CLINIC_ID,
      },
    });
    expect(otpVerification.statusCode).toBe(201);
    const seededAdminLogin = apiSuccessBodySchema.parse(otpVerification.json()).data as LoginData;
    expect(seededAdminLogin.access_token).toBeTruthy();
    expect(seededAdminLogin.user.id).toBe(SEED.CLINIC_ADMIN_ID);
    expect(seededAdminLogin.clinics).toContainEqual(
      expect.objectContaining({
        clinic_id: SEED.CLINIC_ID,
        role: 'clinic_admin',
        doctor_id: null,
        active: true,
      }),
    );

    const seededAdminHeaders = bearerHeaders(seededAdminLogin.access_token);
    const seededAdminMe = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: seededAdminHeaders,
    });
    expect(seededAdminMe.statusCode).toBe(200);
    const seededAdminMeData = apiSuccessBodySchema.parse(seededAdminMe.json()).data as {
      user: { id: string };
      clinics: ClinicContext[];
    };
    expect(seededAdminMeData.user.id).toBe(SEED.CLINIC_ADMIN_ID);
    expect(seededAdminMeData.clinics).toContainEqual(
      expect.objectContaining({
        clinic_id: SEED.CLINIC_ID,
        role: 'clinic_admin',
        doctor_id: null,
        active: true,
      }),
    );

    const createDoctor = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctors`,
      headers: seededAdminHeaders,
      payload: {
        name: 'Dr. Fresh JWT',
        qualification: 'MD',
      },
    });
    expect(createDoctor.statusCode).toBe(201);
    const freshDoctorId = (
      apiSuccessBodySchema.parse(createDoctor.json()).data as { doctor: { id: string } }
    ).doctor.id;

    const doctorsBeforeLogin = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctors`,
      headers: seededAdminHeaders,
    });
    expect(doctorsBeforeLogin.statusCode).toBe(200);
    const freshUnlinkedDoctor = (
      apiSuccessBodySchema.parse(doctorsBeforeLogin.json()).data as {
        doctors: Array<{
          id: string;
          name: string;
          user_id: string | null;
          active: boolean;
        }>;
      }
    ).doctors.find((doctor) => doctor.id === freshDoctorId);
    expect(freshUnlinkedDoctor).toMatchObject({
      id: freshDoctorId,
      name: 'Dr. Fresh JWT',
      user_id: null,
      active: true,
    });

    const usersBeforeLogin = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users`,
      headers: seededAdminHeaders,
    });
    expect(usersBeforeLogin.statusCode).toBe(200);
    const usersBeforeLoginData = apiSuccessBodySchema.parse(usersBeforeLogin.json()).data as {
      users: Array<{ doctor_id: string | null }>;
    };
    expect(usersBeforeLoginData.users.some((user) => user.doctor_id === freshDoctorId)).toBe(false);

    const doctorPassword = 'FreshDoctorPass12';
    const createDoctorLogin = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users`,
      headers: seededAdminHeaders,
      payload: {
        role: 'doctor',
        doctor_id: freshDoctorId,
        login_name: 'fresh.jwt.doctor',
        password: doctorPassword,
      },
    });
    expect(createDoctorLogin.statusCode).toBe(201);
    const doctorLoginCreated = apiSuccessBodySchema.parse(createDoctorLogin.json()).data as {
      user: { id: string; username: string };
      membership: { doctorId: string; role: string };
    };
    expect(doctorLoginCreated.user.username).toBe('fresh.jwt.doctor.1000');
    expect(doctorLoginCreated.membership).toMatchObject({
      role: 'doctor',
      doctorId: freshDoctorId,
    });

    const doctorsAfterLogin = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctors`,
      headers: seededAdminHeaders,
    });
    expect(doctorsAfterLogin.statusCode).toBe(200);
    const linkedDoctor = (
      apiSuccessBodySchema.parse(doctorsAfterLogin.json()).data as {
        doctors: Array<{ id: string; user_id: string | null; active: boolean }>;
      }
    ).doctors.find((doctor) => doctor.id === freshDoctorId);
    expect(linkedDoctor).toMatchObject({
      id: freshDoctorId,
      user_id: doctorLoginCreated.user.id,
      active: true,
    });

    const duplicateDoctorLogin = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users`,
      headers: seededAdminHeaders,
      payload: {
        role: 'doctor',
        doctor_id: freshDoctorId,
        login_name: 'fresh.jwt.duplicate',
        password: 'DuplicateDoctorPass12',
      },
    });
    expect(duplicateDoctorLogin.statusCode).toBe(409);
    expect(apiErrorBodySchema.parse(duplicateDoctorLogin.json()).error.code).toBe('CONFLICT');

    const adminPassword = 'FreshAdminPass12';
    const createAdminLogin = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users`,
      headers: seededAdminHeaders,
      payload: {
        role: 'clinic_admin',
        login_name: 'fresh.jwt.admin',
        password: adminPassword,
      },
    });
    expect(createAdminLogin.statusCode).toBe(201);
    const adminLoginCreated = apiSuccessBodySchema.parse(createAdminLogin.json()).data as {
      user: { id: string; username: string };
      membership: { role: string };
    };
    expect(adminLoginCreated.user.username).toBe('fresh.jwt.admin.1000');
    expect(adminLoginCreated.membership).toMatchObject({ role: 'clinic_admin' });

    const usersAfterProvisioning = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/users`,
      headers: seededAdminHeaders,
    });
    expect(usersAfterProvisioning.statusCode).toBe(200);
    const provisionedUsers = (
      apiSuccessBodySchema.parse(usersAfterProvisioning.json()).data as {
        users: Array<{
          role: string;
          doctor_id: string | null;
          user: { id: string; username: string | null };
        }>;
      }
    ).users;
    expect(provisionedUsers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'doctor',
          doctor_id: freshDoctorId,
          user: expect.objectContaining({
            id: doctorLoginCreated.user.id,
            username: doctorLoginCreated.user.username,
          }),
        }),
        expect.objectContaining({
          role: 'clinic_admin',
          doctor_id: null,
          user: expect.objectContaining({
            id: adminLoginCreated.user.id,
            username: adminLoginCreated.user.username,
          }),
        }),
      ]),
    );

    const doctorLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        username: doctorLoginCreated.user.username,
        password: doctorPassword,
      },
    });
    expect(doctorLogin.statusCode).toBe(201);
    const doctorLoginData = apiSuccessBodySchema.parse(doctorLogin.json()).data as LoginData;
    expect(doctorLoginData.user.id).toBe(doctorLoginCreated.user.id);
    expect(doctorLoginData.clinics).toContainEqual(
      expect.objectContaining({
        clinic_id: SEED.CLINIC_ID,
        role: 'doctor',
        doctor_id: freshDoctorId,
        active: true,
      }),
    );

    const doctorMe = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: bearerHeaders(doctorLoginData.access_token),
    });
    expect(doctorMe.statusCode).toBe(200);
    const doctorMeData = apiSuccessBodySchema.parse(doctorMe.json()).data as {
      user: { id: string };
      clinics: ClinicContext[];
    };
    expect(doctorMeData.user.id).toBe(doctorLoginCreated.user.id);
    expect(doctorMeData.clinics).toContainEqual(
      expect.objectContaining({
        clinic_id: SEED.CLINIC_ID,
        role: 'doctor',
        doctor_id: freshDoctorId,
        active: true,
      }),
    );

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        username: adminLoginCreated.user.username,
        password: adminPassword,
      },
    });
    expect(adminLogin.statusCode).toBe(201);
    const adminLoginData = apiSuccessBodySchema.parse(adminLogin.json()).data as LoginData;
    expect(adminLoginData.user.id).toBe(adminLoginCreated.user.id);
    expect(adminLoginData.clinics).toContainEqual(
      expect.objectContaining({
        clinic_id: SEED.CLINIC_ID,
        role: 'clinic_admin',
        doctor_id: null,
        active: true,
      }),
    );

    const adminMe = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: bearerHeaders(adminLoginData.access_token),
    });
    expect(adminMe.statusCode).toBe(200);
    const adminMeData = apiSuccessBodySchema.parse(adminMe.json()).data as {
      user: { id: string };
      clinics: ClinicContext[];
    };
    expect(adminMeData.user.id).toBe(adminLoginCreated.user.id);
    expect(adminMeData.clinics).toContainEqual(
      expect.objectContaining({
        clinic_id: SEED.CLINIC_ID,
        role: 'clinic_admin',
        doctor_id: null,
        active: true,
      }),
    );
  });
});
