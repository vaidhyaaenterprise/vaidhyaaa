import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clinicUsers, createRepositories, DatabaseService, users, type OtpPurpose } from '@vaidya/db';
import { apiErrorBodySchema, apiSuccessBodySchema } from '@vaidya/shared';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { hashOtp } from '../src/common/crypto/otp';
import { hashPassword } from '../src/common/crypto/password';
import { createTestApp } from './test-app';
import { prepareTestDatabase } from './db-setup';

const JWT_SECRET = 'test_secret';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function seedKnownToken(
  app: NestFastifyApplication,
  email: string,
  purpose: OtpPurpose,
  otp: string,
  overrides: {
    expiresAt?: Date;
    attempts?: number;
    consumed?: boolean;
    verified?: boolean;
  } = {},
) {
  const dbService = app.get(DatabaseService);
  const repos = createRepositories(dbService.database);
  await repos.otp.invalidateAllForEmail(email, purpose);
  const [token] = await repos.otp.insert({
    email,
    otpHash: hashOtp(otp, JWT_SECRET),
    purpose,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000),
  });

  if (token) {
    if (overrides.attempts !== undefined) {
      await repos.otp.setAttempts(token.id, overrides.attempts);
    }
    if (overrides.consumed) {
      await repos.otp.markUsed(token.id);
    }
    if (overrides.verified) {
      await repos.otp.markVerifiedOnly(token.id);
    }
  }

  return token;
}

async function latestToken(app: NestFastifyApplication, email: string, purpose: OtpPurpose) {
  const dbService = app.get(DatabaseService);
  const repos = createRepositories(dbService.database);
  const [token] = await repos.otp.findLatestForEmail(email, purpose);
  return token;
}

describe('Email verification + password reset (OTP)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    await prepareTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('send-verification-code', () => {
    it('sends a code and never returns the OTP', async () => {
      const email = uniqueEmail('sendcode');
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/send-verification-code',
        payload: { email },
      });
      expect(response.statusCode).toBe(201);
      const body = apiSuccessBodySchema.parse(response.json());
      expect(body.data).toEqual({ ok: true });

      const token = await latestToken(app, email, 'EMAIL_VERIFICATION');
      expect(token).toBeTruthy();
      // Stored OTP must be a SHA-256 hash, never the plaintext.
      expect(token?.otpHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(body.data)).not.toMatch(/\d{6}/);
    });

    it('rejects resend within the 60s cooldown', async () => {
      const email = uniqueEmail('cooldown');
      const first = await app.inject({
        method: 'POST',
        url: '/v1/auth/send-verification-code',
        payload: { email },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: '/v1/auth/send-verification-code',
        payload: { email },
      });
      expect(second.statusCode).toBe(429);
      const body = apiErrorBodySchema.parse(second.json());
      expect(body.error.code).toBe('RATE_LIMITED');
    });

    it('rejects sending a code for an already-registered email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/send-verification-code',
        payload: { email: 'admin@sri-murugan.local' },
      });
      expect(response.statusCode).toBe(400);
      const body = apiErrorBodySchema.parse(response.json());
      expect(body.error.message).toBe('Email is already registered.');
    });
  });

  describe('verify-email', () => {
    it('rejects an incorrect OTP and increments the attempt counter', async () => {
      const email = uniqueEmail('wrongotp');
      await seedKnownToken(app, email, 'EMAIL_VERIFICATION', '123456');

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        payload: { email, otp: '000000' },
      });
      expect(response.statusCode).toBe(400);
      const body = apiErrorBodySchema.parse(response.json());
      expect(body.error.message).toContain('Invalid verification code');

      const token = await latestToken(app, email, 'EMAIL_VERIFICATION');
      expect(token?.attempts).toBe(1);
    });

    it('verifies the email with the correct OTP and consumes it', async () => {
      const email = uniqueEmail('verifyok');
      await seedKnownToken(app, email, 'EMAIL_VERIFICATION', '123456');

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        payload: { email, otp: '123456' },
      });
      expect(response.statusCode).toBe(201);

      const token = await latestToken(app, email, 'EMAIL_VERIFICATION');
      expect(token?.verifiedAt).toBeTruthy();
      expect(token?.usedAt).toBeTruthy();

      const replay = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        payload: { email, otp: '123456' },
      });
      expect(replay.statusCode).toBe(400);
    });

    it('rejects an expired code', async () => {
      const email = uniqueEmail('expired');
      await seedKnownToken(app, email, 'EMAIL_VERIFICATION', '123456', {
        expiresAt: new Date(Date.now() - 1000),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        payload: { email, otp: '123456' },
      });
      expect(response.statusCode).toBe(400);
      const body = apiErrorBodySchema.parse(response.json());
      expect(body.error.message).toContain('expired');
    });

    it('rejects a code after the attempt limit is reached', async () => {
      const email = uniqueEmail('exhausted');
      await seedKnownToken(app, email, 'EMAIL_VERIFICATION', '123456', { attempts: 5 });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        payload: { email, otp: '123456' },
      });
      expect(response.statusCode).toBe(400);
      const body = apiErrorBodySchema.parse(response.json());
      expect(body.error.message).toContain('Too many incorrect attempts');
    });
  });

  describe('registration requires verified email', () => {
    it('does not create a user for an unverified email', async () => {
      const email = uniqueEmail('unverified');
      const sent = await app.inject({
        method: 'POST',
        url: '/v1/auth/send-verification-code',
        payload: { email },
      });
      expect(sent.statusCode).toBe(201);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          clinic_name: 'OTP Test Clinic',
          clinic_phone: '+91 90000 00000',
          address_line1: '1 Test Street',
          city: 'Chennai',
          state: 'Tamil Nadu',
          country: 'India',
          zip_code: '600001',
          admin_name: 'Test Admin',
          admin_email: email,
          admin_phone: '+91 90000 00000',
          password: 'secret123',
          confirm_password: 'secret123',
        },
      });
      expect(response.statusCode).toBe(400);
      const body = apiErrorBodySchema.parse(response.json());
      expect(body.error.message).toContain('verify your email');

      const dbService = app.get(DatabaseService);
      const repos = createRepositories(dbService.database);
      const [user] = await repos.auth.findUserByEmail(email);
      expect(user).toBeUndefined();
    });

    it('registers a clinic after the email is verified', async () => {
      const email = uniqueEmail('verifiedreg');
      await seedKnownToken(app, email, 'EMAIL_VERIFICATION', '123456');

      const verified = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        payload: { email, otp: '123456' },
      });
      expect(verified.statusCode).toBe(201);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          clinic_name: 'Verified Clinic',
          clinic_phone: '+91 91111 11111',
          address_line1: '2 Test Street',
          city: 'Chennai',
          state: 'Tamil Nadu',
          country: 'India',
          zip_code: '600002',
          admin_name: 'Verified Admin',
          admin_email: email,
          admin_phone: '+91 91111 11111',
          password: 'secret123',
          confirm_password: 'secret123',
        },
      });
      expect(response.statusCode).toBe(201);
      const body = apiSuccessBodySchema.parse(response.json());
      const data = body.data as { email: string; clinic_unique_number: number };
      expect(data.email).toBe(email);
      expect(Number(data.clinic_unique_number)).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('forgot password', () => {
    it('returns the generic response for an unknown email and does not create a token', async () => {
      const email = uniqueEmail('unknown');
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        payload: { email },
      });
      expect(response.statusCode).toBe(201);
      const body = apiSuccessBodySchema.parse(response.json());
      expect(body.data).toEqual({ ok: true });

      const token = await latestToken(app, email, 'PASSWORD_RESET');
      expect(token).toBeUndefined();
    });

    it('enforces the resend cooldown for forgot-password', async () => {
      const email = uniqueEmail('fpcooldown');
      await seedKnownToken(app, email, 'PASSWORD_RESET', '123456');

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        payload: { email },
      });
      expect(response.statusCode).toBe(429);
    });

    it('resets a known user password end-to-end and signs in with the new password', async () => {
      const email = uniqueEmail('resetme');
      const dbService = app.get(DatabaseService);

      const oldHash = hashPassword('oldPassword123');
      const [createdUser] = await dbService.database
        .insert(users)
        .values({
          name: 'Reset Me',
          email,
          username: 'resetme.unique',
          passwordHash: oldHash.hash,
          passwordSalt: oldHash.salt,
          active: true,
        })
        .returning();
      await dbService.database.insert(clinicUsers).values({
        clinicId: '00000000-0000-0000-0000-000000000001',
        userId: createdUser!.id,
        role: 'clinic_admin',
        active: true,
      });

      const forgot = await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        payload: { email },
      });
      expect(forgot.statusCode).toBe(201);

      await seedKnownToken(app, email, 'PASSWORD_RESET', '654321');

      const wrongKeep = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-password-reset-code',
        payload: { email, otp: '000000' },
      });
      expect(wrongKeep.statusCode).toBe(400);

      const verify = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-password-reset-code',
        payload: { email, otp: '654321' },
      });
      expect(verify.statusCode).toBe(201);

      const mismatch = await app.inject({
        method: 'POST',
        url: '/v1/auth/reset-password',
        payload: {
          email,
          otp: '654321',
          new_password: 'brandNewPass1',
          confirm_password: 'wrong-mismatch',
        },
      });
      expect(mismatch.statusCode).toBe(400);

      const reset = await app.inject({
        method: 'POST',
        url: '/v1/auth/reset-password',
        payload: {
          email,
          otp: '654321',
          new_password: 'brandNewPass1',
          confirm_password: 'brandNewPass1',
        },
      });
      expect(reset.statusCode).toBe(201);

      const token = await latestToken(app, email, 'PASSWORD_RESET');
      expect(token?.usedAt).toBeTruthy();

      const replay = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-password-reset-code',
        payload: { email, otp: '654321' },
      });
      expect(replay.statusCode).toBe(400);

      const oldLogin = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { username: email, password: 'oldPassword123' },
      });
      expect(oldLogin.statusCode).toBe(401);

      const newLogin = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { username: email, password: 'brandNewPass1' },
      });
      expect(newLogin.statusCode).toBe(201);
      const body = apiSuccessBodySchema.parse(newLogin.json());
      expect((body.data as { access_token: string }).access_token).toBeTruthy();
    });
  });
});