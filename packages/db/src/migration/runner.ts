import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';

import { assertSupabaseDatabaseUrl } from '@vaidya/config';

const MIGRATIONS_TABLE = 'vaidya_schema_migrations';

function assertRuntimeDatabaseTarget(connectionString: string): void {
  if (process.env.NODE_ENV !== 'test') {
    assertSupabaseDatabaseUrl(connectionString);
  }
}

export type MigrationRecord = {
  name: string;
  appliedAt: Date;
};

export function getMigrationsDir(): string {
  return join(__dirname, '../../migrations');
}

export function getSeedFilePath(): string {
  return join(__dirname, '../../seed/002_seed_minimal_qa.sql');
}

export function listMigrationFiles(): string[] {
  return readdirSync(getMigrationsDir())
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id serial PRIMARY KEY,
      name text NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function getAppliedMigrations(connectionString: string): Promise<MigrationRecord[]> {
  assertRuntimeDatabaseTarget(connectionString);
  const sql = postgres(connectionString, { max: 1 });
  try {
    await ensureMigrationsTable(sql);
    const rows = await sql<{ name: string; applied_at: Date }[]>`
      SELECT name, applied_at FROM vaidya_schema_migrations ORDER BY applied_at ASC
    `;
    return rows.map((row) => ({ name: row.name, appliedAt: row.applied_at }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function runMigrations(connectionString: string): Promise<string[]> {
  assertRuntimeDatabaseTarget(connectionString);
  const sql = postgres(connectionString, { max: 1 });
  const applied: string[] = [];

  try {
    await ensureMigrationsTable(sql);
    const existing = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM vaidya_schema_migrations`).map(
        (row) => row.name,
      ),
    );

    for (const file of listMigrationFiles()) {
      if (existing.has(file)) {
        continue;
      }

      const sqlContent = readFileSync(join(getMigrationsDir(), file), 'utf8');
      await sql.unsafe(sqlContent);
      await sql`INSERT INTO vaidya_schema_migrations (name) VALUES (${file})`;
      applied.push(file);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  return applied;
}

export async function runSeed(connectionString: string): Promise<void> {
  assertRuntimeDatabaseTarget(connectionString);
  const sql = postgres(connectionString, { max: 1 });
  try {
    const seedSql = readFileSync(getSeedFilePath(), 'utf8');
    await sql.unsafe(seedSql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function resetDatabase(connectionString: string): Promise<void> {
  assertRuntimeDatabaseTarget(connectionString);
  const sql = postgres(connectionString, { max: 1 });
  try {
    await sql.unsafe(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO public;
    `);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
