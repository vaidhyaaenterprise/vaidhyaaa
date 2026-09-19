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
      idle_timeout: 5,
      connect_timeout: 5,
      max_lifetime: 300,
      fetch_types: false,
      connection: {
        application_name: 'vaidya-api',
      },
    });

    // Postgres.js is lazy, so ending this unused client does not open a network
    // connection. This keeps the test focused on configuration only.
    await closeDatabaseConnection(connection);
  });
});
