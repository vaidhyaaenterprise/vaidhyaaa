import { describe, expect, it } from 'vitest';

import { EnvValidationError, parseApiEnv, parseWebEnv } from './env';

const validApiEnv: Record<string, string> = {
  NODE_ENV: 'test',
  APP_ENV: 'local',
  API_PORT: '3000',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/vaidya_local',
  JWT_SECRET: 'dev_only_change_me',
  API_BASE_URL: 'http://localhost:3000',
};

describe('parseApiEnv', () => {
  it('parses valid API environment', () => {
    const env = parseApiEnv(validApiEnv);
    expect(env.API_PORT).toBe(3000);
    expect(env.DATABASE_URL).toContain('postgresql://');
    expect(env.QUEUE_MODE).toBe('inline');
    expect(env.JOB_WORKER_ENABLED).toBe(false);
  });

  it('accepts a secure Supabase URL for QA', () => {
    const env = parseApiEnv({
      ...validApiEnv,
      APP_ENV: 'qa',
      DATABASE_URL:
        'postgresql://postgres.project-ref:password@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require',
    });
    expect(env.DATABASE_URL).toContain('supabase.com');
  });

  it('requires Supabase for local application development', () => {
    expect(() =>
      parseApiEnv({
        ...validApiEnv,
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/vaidya_local',
      }),
    ).toThrow('Supabase PostgreSQL connection URL');
  });

  it('rejects a local database URL outside local and test environments', () => {
    expect(() =>
      parseApiEnv({
        ...validApiEnv,
        APP_ENV: 'qa',
      }),
    ).toThrow('must use a Supabase PostgreSQL connection URL');
  });

  it('rejects an insecure Supabase database URL outside local and test environments', () => {
    expect(() =>
      parseApiEnv({
        ...validApiEnv,
        APP_ENV: 'qa',
        DATABASE_URL:
          'postgresql://postgres.project-ref:password@aws-0-us-east-2.pooler.supabase.com:5432/postgres',
      }),
    ).toThrow('must set sslmode=require');
  });

  it('fails when required env is missing', () => {
    const { DATABASE_URL: _removed, ...incomplete } = validApiEnv;
    expect(() => parseApiEnv(incomplete)).toThrow(EnvValidationError);
    try {
      parseApiEnv(incomplete);
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const envError = error as EnvValidationError;
      expect(envError.issues.some((issue) => issue.path.includes('DATABASE_URL'))).toBe(true);
    }
  });

  it('maps legacy redis queue mode to bullmq', () => {
    const env = parseApiEnv({
      ...validApiEnv,
      QUEUE_MODE: 'redis',
      REDIS_URL: 'redis://localhost:6379',
    });
    expect(env.QUEUE_MODE).toBe('bullmq');
  });

  it('requires REDIS_URL when QUEUE_MODE is bullmq', () => {
    expect(() =>
      parseApiEnv({
        ...validApiEnv,
        QUEUE_MODE: 'bullmq',
      }),
    ).toThrow(EnvValidationError);
  });

  it('parses JOB_WORKER_ENABLED=true', () => {
    const env = parseApiEnv({
      ...validApiEnv,
      JOB_WORKER_ENABLED: 'true',
    });
    expect(env.JOB_WORKER_ENABLED).toBe(true);
  });

  it('defaults receptionist agent tool loop to sarvam-105b and fastpath to sarvam-30b', () => {
    const env = parseApiEnv(validApiEnv);
    expect(env.RECEPTIONIST_AGENT_MODEL).toBe('sarvam-105b');
    expect(env.RECEPTIONIST_AGENT_FASTPATH_MODEL).toBe('sarvam-30b');
    expect(env.RECEPTIONIST_AGENT_FALLBACK_MODEL).toBe('sarvam-105b');
  });
});

describe('parseWebEnv', () => {
  it('parses valid web environment', () => {
    const env = parseWebEnv({
      NODE_ENV: 'development',
      WEB_PORT: '3001',
      NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3000',
    });
    expect(env.WEB_PORT).toBe(3001);
  });
});
