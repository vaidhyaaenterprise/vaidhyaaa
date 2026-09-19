import { describe, expect, it } from 'vitest';

import { closeDatabaseConnection, createDatabaseConnection } from '../src/client';

describe('database client options', () => {
  it('uses transaction-pooler-safe limits for serverless runtimes', async () => {
    const connection = createDatabaseConnection(
      'postgresql://postgres:postgres@localhost:5432/vaidya_test',
    );

    expect(connection.client.options).toMatchObject({
      max: 1,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
      max_lifetime: 1_800,
      connection: {
        application_name: 'vaidya-api',
      },
    });

    // Postgres.js is lazy, so ending this unused client does not open a network
    // connection. This keeps the test focused on configuration only.
    await closeDatabaseConnection(connection);
  });
});
