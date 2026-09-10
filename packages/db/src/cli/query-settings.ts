import { createDatabaseConnection, closeDatabaseConnection, createRepositories } from '../index';

import { resolveDatabaseUrl } from './env';

async function main(): Promise<void> {
  const clinicId = process.argv[2] ?? '00000000-0000-0000-0000-000000000001';
  const connectionString = resolveDatabaseUrl();
  const connection = createDatabaseConnection(connectionString);

  try {
    const repos = createRepositories(connection.db);
    const row = await repos.clinics.findClinicSettings(clinicId);

    if (!row[0]) {
      console.log(`No clinic_settings row found for clinic_id=${clinicId}`);
      return;
    }

    console.log(
      JSON.stringify(
        {
          clinic_id: row[0].clinicId,
          fallback_phone: row[0].fallbackPhone,
          overflow_after_rings: row[0].overflowAfterRings,
          updated_at: row[0].updatedAt,
        },
        null,
        2,
      ),
    );
  } finally {
    await closeDatabaseConnection(connection);
  }
}

main().catch((error: unknown) => {
  console.error('Query failed:', error);
  process.exit(1);
});
