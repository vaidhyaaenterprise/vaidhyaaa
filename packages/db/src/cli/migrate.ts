import { runMigrations } from '../migration/runner';
import { resolveDatabaseUrl } from './env';

async function main(): Promise<void> {
  const connectionString = resolveDatabaseUrl();
  const applied = await runMigrations(connectionString);

  if (applied.length === 0) {
    console.log('No pending migrations.');
    return;
  }

  console.log(`Applied migrations:\n${applied.map((name) => `- ${name}`).join('\n')}`);
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
