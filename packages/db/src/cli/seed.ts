import { runSeed } from '../migration/runner';
import { resolveDatabaseUrl } from './env';

async function main(): Promise<void> {
  const connectionString = resolveDatabaseUrl();
  await runSeed(connectionString);
  console.log('Seed applied: 002_seed_minimal_qa.sql');
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
