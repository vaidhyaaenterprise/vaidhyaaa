import { and, desc, eq } from 'drizzle-orm';

import { createDatabaseConnection, closeDatabaseConnection, generatedSlotBatches } from '../index';

import { resolveDatabaseUrl } from './env';

async function main(): Promise<void> {
  const clinicId = process.argv[2] ?? '00000000-0000-0000-0000-000000000001';
  const connectionString = resolveDatabaseUrl();
  const connection = createDatabaseConnection(connectionString);

  try {
    const rows = await connection.db
      .select()
      .from(generatedSlotBatches)
      .where(and(eq(generatedSlotBatches.clinicId, clinicId), eq(generatedSlotBatches.triggerSource, 'daily_job')))
      .orderBy(desc(generatedSlotBatches.startedAt))
      .limit(1);

    if (!rows[0]) {
      console.log(`No generated_slot_batches row found for clinic_id=${clinicId}`);
      return;
    }

    console.log(
      JSON.stringify(
        {
          id: rows[0].id,
          clinic_id: rows[0].clinicId,
          trigger_source: rows[0].triggerSource,
          started_at: rows[0].startedAt,
          completed_at: rows[0].completedAt,
          status: rows[0].status,
          summary_json: rows[0].summaryJson,
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
