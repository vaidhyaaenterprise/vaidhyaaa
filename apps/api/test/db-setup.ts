import { resetDatabase, runMigrations, runSeed } from '@vaidya/db';

export function getTestDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5433/vaidya_test'
  );
}

export async function prepareTestDatabase(): Promise<void> {
  const connectionString = getTestDatabaseUrl();
  await resetDatabase(connectionString);
  await runMigrations(connectionString);
  await runSeed(connectionString);
}
