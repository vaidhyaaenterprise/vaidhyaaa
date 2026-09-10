import { assertSupabaseDatabaseUrl, loadLocalEnv } from '@vaidya/config';

export function assertResetAllowed(
  appEnv: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  const env = appEnv ?? 'local';
  if (env !== 'local' || nodeEnv !== 'test') {
    throw new Error('Database reset is only allowed for NODE_ENV=test and APP_ENV=local.');
  }
}

export function resolveDatabaseUrl(): string {
  loadLocalEnv();
  const isLocalTest = process.env.NODE_ENV === 'test' && process.env.APP_ENV === 'local';
  const url = isLocalTest
    ? (process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL)
    : process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for application and database commands.');
  }

  if (!isLocalTest) {
    assertSupabaseDatabaseUrl(url);
  }

  return url;
}
