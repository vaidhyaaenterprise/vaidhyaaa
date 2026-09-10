import { resetDatabase, runMigrations } from '../migration/runner';
import { assertResetAllowed, resolveDatabaseUrl } from './env';

async function main(): Promise<void> {
  const connectionString = resolveDatabaseUrl();
  assertResetAllowed(process.env.APP_ENV, process.env.NODE_ENV);

  console.log('Resetting database schema...');
  await resetDatabase(connectionString);

  const applied = await runMigrations(connectionString);
  console.log(`Database reset complete. Applied migrations:\n${applied.map((n) => `- ${n}`).join('\n')}`);
}

main().catch((error: unknown) => {
  console.error('Reset failed:', error);
  process.exit(1);
});
