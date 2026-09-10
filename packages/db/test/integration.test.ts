import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertResetAllowed,
  closeDatabaseConnection,
  createDatabaseConnection,
  createRepositories,
  DatabaseService,
  getAppliedMigrations,
  resetDatabase,
  runMigrations,
  runSeed,
} from '../src';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/vaidya_test';

const SEED_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const SEED_DOCTOR_ID = '00000000-0000-0000-0000-000000000201';
const SEED_SERVICE_ID = '00000000-0000-0000-0000-000000000301';

type PostgresErrorLike = Error & { code?: string };

async function expectPostgresError(
  fn: () => Promise<unknown>,
  code?: string,
): Promise<PostgresErrorLike> {
  try {
    await fn();
    throw new Error('Expected PostgreSQL error');
  } catch (error) {
    if (error instanceof Error && error.message === 'Expected PostgreSQL error') {
      throw error;
    }

    const pgError = error as PostgresErrorLike;
    if (code) {
      expect(pgError.code).toBe(code);
    }
    return pgError;
  }
}

describe('@vaidya/db integration', () => {
  let sql!: postgres.Sql;
  let connection!: ReturnType<typeof createDatabaseConnection>;
  let dbService!: DatabaseService;

  beforeAll(async () => {
    sql = postgres(TEST_DATABASE_URL, { max: 1 });
    await resetDatabase(TEST_DATABASE_URL);
    connection = createDatabaseConnection(TEST_DATABASE_URL);
    dbService = new DatabaseService(connection.db);
  });

  afterAll(async () => {
    await closeDatabaseConnection(connection);
    await sql.end({ timeout: 5 });
  });

  it('1. applies initial migration to an empty database', async () => {
    const applied = await runMigrations(TEST_DATABASE_URL);
    expect(applied).toContain('001_initial_schema_production.sql');
    expect(applied).toContain('002_c04_schema_alignment.sql');

    const status = await getAppliedMigrations(TEST_DATABASE_URL);
    expect(status.some((row) => row.name === '001_initial_schema_production.sql')).toBe(true);
    expect(status.some((row) => row.name === '002_c04_schema_alignment.sql')).toBe(true);

    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name IN ('clinics', 'appointment_slots', 'slot_holds', 'appointment_requests')
    `;
    expect(tables).toHaveLength(4);
  });

  it('2. applies seed after migration', async () => {
    await expect(runSeed(TEST_DATABASE_URL)).resolves.toBeUndefined();
  });

  it('3. seed creates clinic, admin, doctors, services, mappings, rules, templates, and knowledge', async () => {
    const repos = createRepositories(connection.db);

    const [clinic] = await repos.clinics.findClinicById(SEED_CLINIC_ID);
    expect(clinic?.name).toBe('Sri Murugan Clinic');

    const admins = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM clinic_users
      WHERE clinic_id = ${SEED_CLINIC_ID}::uuid AND role = 'clinic_admin'
    `;
    expect(Number(admins[0]?.count)).toBe(1);

    const doctors = await repos.clinical.listDoctors(SEED_CLINIC_ID);
    expect(doctors.length).toBe(3);

    const services = await repos.clinical.listServices(SEED_CLINIC_ID);
    expect(services.length).toBe(3);

    const mappings = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM doctor_services WHERE clinic_id = ${SEED_CLINIC_ID}::uuid
    `;
    expect(Number(mappings[0]?.count)).toBe(3);

    const rules = await repos.clinical.listBookingRules(SEED_CLINIC_ID);
    expect(rules.length).toBe(3);

    const templates = await repos.clinical.listTemplates();
    expect(templates.length).toBeGreaterThan(0);

    const knowledge = await repos.clinical.listKnowledge(SEED_CLINIC_ID);
    expect(knowledge.length).toBeGreaterThanOrEqual(3);
  });

  it('4. composite clinic-scoped FK rejects doctor from another clinic', async () => {
    const otherClinicId = '00000000-0000-0000-0000-000000000099';
    const otherDoctorId = '00000000-0000-0000-0000-000000000299';

    await sql`
      INSERT INTO clinics (id, name, primary_phone, address_line1, city, state, country, timezone, default_language_code)
      VALUES (${otherClinicId}::uuid, 'Other Clinic', '+914400000099', 'Test', 'Chennai', 'TN', 'India', 'Asia/Kolkata', 'english')
    `;

    await sql`
      INSERT INTO doctors (id, clinic_id, name, qualification, active)
      VALUES (${otherDoctorId}::uuid, ${otherClinicId}::uuid, 'Dr Other', 'MBBS', true)
    `;

    await expectPostgresError(
      () =>
        sql`
          INSERT INTO doctor_services (clinic_id, doctor_id, clinic_service_id, active)
          VALUES (${SEED_CLINIC_ID}::uuid, ${otherDoctorId}::uuid, ${SEED_SERVICE_ID}::uuid, true)
        `,
      '23503',
    );
  });

  it('5. appointment_slots.capacity_total > 0 constraint works', async () => {
    await expectPostgresError(
      () =>
        sql`
          INSERT INTO appointment_slots (
            clinic_id, doctor_id, clinic_service_id, start_time, end_time, capacity_total, status
          )
          VALUES (
            ${SEED_CLINIC_ID}::uuid,
            ${SEED_DOCTOR_ID}::uuid,
            ${SEED_SERVICE_ID}::uuid,
            now() + interval '1 day',
            now() + interval '1 day 15 minutes',
            0,
            'open'
          )
        `,
      '23514',
    );
  });

  it('6. appointment_slots.end_time > start_time constraint works', async () => {
    await expectPostgresError(
      () =>
        sql`
          INSERT INTO appointment_slots (
            clinic_id, doctor_id, clinic_service_id, start_time, end_time, capacity_total, status
          )
          VALUES (
            ${SEED_CLINIC_ID}::uuid,
            ${SEED_DOCTOR_ID}::uuid,
            ${SEED_SERVICE_ID}::uuid,
            now() + interval '1 day',
            now() + interval '1 day' - interval '15 minutes',
            1,
            'open'
          )
        `,
      '23514',
    );
  });

  it('7. slot_holds.status rejects invalid value', async () => {
    const [slot] = await sql<{ id: string }[]>`
      INSERT INTO appointment_slots (
        clinic_id, doctor_id, clinic_service_id, start_time, end_time, capacity_total, status
      )
      VALUES (
        ${SEED_CLINIC_ID}::uuid,
        ${SEED_DOCTOR_ID}::uuid,
        ${SEED_SERVICE_ID}::uuid,
        now() + interval '2 days',
        now() + interval '2 days 15 minutes',
        1,
        'open'
      )
      RETURNING id
    `;

    await expectPostgresError(
      () =>
        sql`
          INSERT INTO slot_holds (clinic_id, slot_id, status, hold_expires_at)
          VALUES (${SEED_CLINIC_ID}::uuid, ${slot!.id}::uuid, 'invalid_status', now() + interval '10 minutes')
        `,
      '23514',
    );
  });

  it('8. appointment_requests.reason_for_visit is required', async () => {
    await expectPostgresError(
      () =>
        sql`
          INSERT INTO appointment_requests (
            clinic_id,
            patient_name,
            doctor_id,
            clinic_service_id,
            appointment_start,
            appointment_end,
            status
          )
          VALUES (
            ${SEED_CLINIC_ID}::uuid,
            'Test Patient',
            ${SEED_DOCTOR_ID}::uuid,
            ${SEED_SERVICE_ID}::uuid,
            now() + interval '3 days',
            now() + interval '3 days 15 minutes',
            'pending_confirmation'
          )
        `,
      '23502',
    );
  });

  it('9. patient phone/name uniqueness works with normalized fields', async () => {
    await sql`
      INSERT INTO patients (clinic_id, name, normalized_name, phone, normalized_phone)
      VALUES (
        ${SEED_CLINIC_ID}::uuid,
        'Ravi Kumar',
        'ravi kumar',
        '+919876543210',
        '+919876543210'
      )
    `;

    await expectPostgresError(
      () =>
        sql`
          INSERT INTO patients (clinic_id, name, normalized_name, phone, normalized_phone)
          VALUES (
            ${SEED_CLINIC_ID}::uuid,
            'Ravi Kumar',
            'ravi kumar',
            '+919876543210',
            '+919876543210'
          )
        `,
      '23505',
    );
  });

  it('10. no table stores MP3 binary data', async () => {
    const binaryColumns = await dbService.assertNoBinaryAudioColumns();
    expect(binaryColumns).toEqual([]);
  });
});

describe('db reset guard', () => {
  it('blocks reset in production and staging', () => {
    expect(() => assertResetAllowed('production', 'test')).toThrow(/only allowed/);
    expect(() => assertResetAllowed('staging', 'test')).toThrow(/only allowed/);
    expect(() => assertResetAllowed('local', 'test')).not.toThrow();
    expect(() => assertResetAllowed('qa', 'test')).toThrow(/only allowed/);
    expect(() => assertResetAllowed('local', 'development')).toThrow(/only allowed/);
  });
});
