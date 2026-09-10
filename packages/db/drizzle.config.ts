import { defineConfig } from 'drizzle-kit';

import { assertSupabaseDatabaseUrl, loadLocalEnv } from '@vaidya/config';

loadLocalEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for Drizzle commands.');
}
if (!(process.env.NODE_ENV === 'test' && process.env.APP_ENV === 'local')) {
  assertSupabaseDatabaseUrl(databaseUrl);
}

/** Drizzle Kit is used for introspection/status only. Schema changes come from SQL migrations. */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
});
