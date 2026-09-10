import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EnvValidationError, parseApiEnv } from '@vaidya/config';
import {
  apiErrorBodySchema,
  apiSuccessBodySchema,
  REQUEST_ID_HEADER,
} from '@vaidya/shared';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createTestApp } from './test-app';
import { prepareTestDatabase } from './db-setup';

describe('Vaidya API bootstrap', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    await prepareTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('health endpoint returns OK with success envelope', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
    });

    expect(response.statusCode).toBe(200);
    const body = apiSuccessBodySchema.parse(response.json());
    expect(body.data).toEqual({
      status: 'ok',
      service: 'vaidya-api',
    });
    expect(body.meta.request_id).toMatch(/^req_/);
    expect(body.meta.debug).toBeNull();
  });

  it('attaches request ID to every API response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: {
        [REQUEST_ID_HEADER]: 'req_custom_test_id',
      },
    });

    expect(response.headers[REQUEST_ID_HEADER]).toBe('req_custom_test_id');
    const body = apiSuccessBodySchema.parse(response.json());
    expect(body.meta.request_id).toBe('req_custom_test_id');
  });

  it('standard error filter returns the standard error shape', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/__test__/app-error',
    });

    expect(response.statusCode).toBe(400);
    const body = apiErrorBodySchema.parse(response.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Human readable message.');
    expect(body.error.details).toEqual({ field: 'name' });
    expect(body.error.request_id).toMatch(/^req_/);
    expect(response.headers[REQUEST_ID_HEADER]).toBe(body.error.request_id);
  });

  it('maps conflict error codes to HTTP 409 per LLD', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/__test__/slot-error',
    });

    expect(response.statusCode).toBe(409);
    const body = apiErrorBodySchema.parse(response.json());
    expect(body.error.code).toBe('SLOT_NOT_AVAILABLE');
  });

  it('GET /v1/me returns authenticated user context in dev mode', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
    });

    expect(response.statusCode).toBe(200);
    const body = apiSuccessBodySchema.parse(response.json());
    const data = body.data as {
      user: { id: string; platform_role: string | null };
      clinics: Array<{ clinic_id: string; role: string }>;
    };
    expect(data.user.id).toBe('00000000-0000-0000-0000-000000000102');
    expect(data.user.platform_role).toBeNull();
    expect(data.clinics[0]).toMatchObject({
      clinic_id: '00000000-0000-0000-0000-000000000001',
      role: 'clinic_admin',
    });
  });

  it('POST /v1/auth/request-otp works for invited users', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/request-otp',
      payload: { identifier: 'admin@sri-murugan.local' },
    });

    expect(response.statusCode).toBe(201);
    const body = apiSuccessBodySchema.parse(response.json());
    expect((body.data as { challenge_id: string }).challenge_id).toBeTruthy();
  });
});

describe('env validation', () => {
  it('fails when required env is missing', () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: 'test',
        JWT_SECRET: 'test',
      }),
    ).toThrow(EnvValidationError);
  });
});
