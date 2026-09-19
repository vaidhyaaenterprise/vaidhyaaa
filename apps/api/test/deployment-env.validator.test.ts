import { describe, expect, it } from 'vitest';

import { parseApiEnv } from '@vaidya/config';

import { assertVercelDeploymentEnv } from '../src/config/deployment-env.validator';

const validVercelEnv = parseApiEnv({
  NODE_ENV: 'production',
  APP_ENV: 'production',
  AUTH_MODE: 'jwt',
  DATABASE_URL:
    'postgresql://postgres.project-ref:password@aws-0-us-east-2.pooler.supabase.com:6543/postgres?sslmode=require',
  JWT_SECRET: 'valid-random-test-secret-with-more-than-32-characters',
});

describe('assertVercelDeploymentEnv', () => {
  it('accepts a production-safe Vercel environment', () => {
    expect(() => assertVercelDeploymentEnv(validVercelEnv)).not.toThrow();
  });

  it('rejects the Supabase session pooler', () => {
    expect(() =>
      assertVercelDeploymentEnv({
        ...validVercelEnv,
        DATABASE_URL:
          'postgresql://postgres.project-ref:password@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require',
      }),
    ).toThrow('transaction pooler URL on port 6543');
  });

  it('rejects local application mode', () => {
    expect(() =>
      assertVercelDeploymentEnv({
        ...validVercelEnv,
        APP_ENV: 'local',
      }),
    ).toThrow('APP_ENV must be qa, staging, or production');
  });

  it('rejects development authentication', () => {
    expect(() =>
      assertVercelDeploymentEnv({
        ...validVercelEnv,
        AUTH_MODE: 'dev',
      }),
    ).toThrow('AUTH_MODE=dev is not allowed');
  });
});
