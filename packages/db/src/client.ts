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
    // Release idle serverless clients quickly. A warm Vercel instance does not
    // need to pin a Supavisor client connection between bursts of traffic.
    idle_timeout: 5,
    connect_timeout: 5,
    max_lifetime: 300,
    // The application only uses built-in PostgreSQL types. Avoiding the type
    // discovery query reduces cold-start work and is safer through transaction
    // poolers, where consecutive queries can use different backend sessions.
    fetch_types: false,
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
