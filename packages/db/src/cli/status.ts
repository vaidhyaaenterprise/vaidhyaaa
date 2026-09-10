import { getAppliedMigrations, listMigrationFiles } from '../migration/runner';
import { resolveDatabaseUrl } from './env';

async function main(): Promise<void> {
  const connectionString = resolveDatabaseUrl();
  const files = listMigrationFiles();
  const applied = await getAppliedMigrations(connectionString);
  const appliedSet = new Set(applied.map((row) => row.name));

  console.log('Migration status:');
  for (const file of files) {
    const status = appliedSet.has(file) ? 'applied' : 'pending';
    console.log(`- ${file}: ${status}`);
  }
}

main().catch((error: unknown) => {
  console.error('Status check failed:', error);
  process.exit(1);
});
