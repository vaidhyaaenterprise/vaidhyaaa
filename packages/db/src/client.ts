import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { assertSupabaseDatabaseUrl } from '@vaidya/config';

import { schema, type VaidyaSchema } from './schema';

export type Database = PostgresJsDatabase<VaidyaSchema>;
export type DatabaseClient = Sql;

export type DatabaseConnection = {
  db: Database;
  client: DatabaseClient;
};

function assertRuntimeDatabaseTarget(connectionString: string): void {
  if (process.env.NODE_ENV !== 'test') {
    assertSupabaseDatabaseUrl(connectionString);
  }
}

export function createDatabaseConnection(connectionString: string): DatabaseConnection {
  assertRuntimeDatabaseTarget(connectionString);
  const client = postgres(connectionString, {
    // Serverless runtimes can keep several warm instances alive at once. Limiting
    // each instance to one connection prevents those instances from exhausting
    // the upstream database pool.
    max: 1,
    // Transaction poolers cannot safely retain prepared statements between
    // requests because a later transaction may use a different backend session.
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 1_800,
    connection: {
      application_name: 'vaidya-api',
    },
  });
  const db = drizzle(client, { schema });
  return { db, client };
}

export function createDatabase(connectionString: string): Database {
  return createDatabaseConnection(connectionString).db;
}

export async function closeDatabaseConnection(connection: DatabaseConnection): Promise<void> {
  await connection.client.end({ timeout: 5 });
}
