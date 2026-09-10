import { afterEach, describe, expect, it } from 'vitest';

import { createDatabaseConnection } from '../src/client';
import { getAppliedMigrations } from '../src/migration/runner';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe('runtime database guard', () => {
  it('rejects local database connections outside test mode', () => {
    process.env.NODE_ENV = 'development';

    expect(() =>
      createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/vaidya_local'),
    ).toThrow('Supabase PostgreSQL connection URL');
  });

  it('rejects local migration targets outside test mode', async () => {
    process.env.NODE_ENV = 'development';

    await expect(
      getAppliedMigrations('postgresql://postgres:postgres@localhost:5432/vaidya_local'),
    ).rejects.toThrow('Supabase PostgreSQL connection URL');
  });
});
