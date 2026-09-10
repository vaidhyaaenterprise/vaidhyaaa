import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadLocalEnv } from './load-local-env';
import { parseApiEnv } from './env';

describe('loadLocalEnv', () => {
  const originalEnv = { ...process.env };
  let tempDir = '';

  afterEach(() => {
    process.env = { ...originalEnv };
    tempDir = '';
  });

  it('loads env files in order with app-level overrides', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'vaidya-env-'));
    writeFileSync(
      join(tempDir, '.env'),
      'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app_db\nJWT_SECRET=app_secret\n',
    );
    writeFileSync(
      join(tempDir, 'root.env'),
      'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/root_db\nJWT_SECRET=root_secret\n',
    );

    process.env = {};
    loadLocalEnv(tempDir);

    expect(process.env.DATABASE_URL).toBe('postgresql://postgres:postgres@localhost:5432/app_db');
    expect(process.env.JWT_SECRET).toBe('app_secret');
  });

  it('allows parseApiEnv to succeed after loading a valid env file', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'vaidya-env-'));
    writeFileSync(
      join(tempDir, '.env'),
      [
        'NODE_ENV=test',
        'APP_ENV=local',
        'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vaidya_local',
        'JWT_SECRET=dev_only_change_me',
      ].join('\n'),
    );

    process.env = {};
    loadLocalEnv(tempDir);

    const env = parseApiEnv();
    expect(env.DATABASE_URL).toContain('vaidya_local');
    expect(env.JWT_SECRET).toBe('dev_only_change_me');
  });
});
