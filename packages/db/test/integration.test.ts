import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { sql as query } from 'drizzle-orm';
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

  it('11. call retention deletes expired logs/transcripts while preserving linked operational records', async () => {
    const rollback = new Error('rollback call-retention test fixtures');
    await expect(connection.db.transaction(async (tx) => {
      const expiredId = randomUUID();
      const boundaryId = randomUUID();
      const appointmentId = randomUUID();
      const patientId = randomUUID();
      const callbackId = randomUUID();
      const emergencyId = randomUUID();
      const actionId = randomUUID();
      const cutoff = new Date('2026-09-09T12:00:00Z');
      await tx.execute(query`INSERT INTO patients (id, clinic_id, name)
        VALUES (${patientId}, ${SEED_CLINIC_ID}, 'Retention test patient')`);
      await tx.execute(query`INSERT INTO appointment_requests
        (id, clinic_id, patient_id, patient_name, doctor_id, clinic_service_id,
         reason_for_visit, appointment_start, appointment_end, status)
        VALUES (${appointmentId}, ${SEED_CLINIC_ID}, ${patientId}, 'Retention test patient',
          ${SEED_DOCTOR_ID}, ${SEED_SERVICE_ID}, 'Review', '2026-11-01 09:00', '2026-11-01 09:15', 'confirmed')`);
      await tx.execute(query`INSERT INTO calls (id, clinic_id, patient_id, started_at, created_appointment_request_id)
        VALUES (${expiredId}, ${SEED_CLINIC_ID}, ${patientId}, '2026-09-01T12:00:00Z', ${appointmentId}),
          (${boundaryId}, ${SEED_CLINIC_ID}, ${patientId}, ${cutoff.toISOString()}, NULL)`);
      await tx.execute(query`INSERT INTO call_transcripts (clinic_id, call_id, speaker, transcript_text)
        VALUES (${SEED_CLINIC_ID}, ${expiredId}, 'patient', 'Expired transcript')`);
      await tx.execute(query`INSERT INTO callback_requests (id, clinic_id, source_call_id)
        VALUES (${callbackId}, ${SEED_CLINIC_ID}, ${expiredId})`);
      await tx.execute(query`INSERT INTO emergency_incidents (id, clinic_id, source_call_id)
        VALUES (${emergencyId}, ${SEED_CLINIC_ID}, ${expiredId})`);
      await tx.execute(query`INSERT INTO appointment_action_requests
        (id, clinic_id, appointment_id, request_type, requested_by, source_call_id)
        VALUES (${actionId}, ${SEED_CLINIC_ID}, ${appointmentId}, 'cancel', 'patient_call', ${expiredId})`);
      const repository = createRepositories(tx as unknown as typeof connection.db).callInbox;
      expect(await repository.deleteExpiredCall(SEED_CLINIC_ID, expiredId, cutoff)).toBe(true);
      expect(await repository.deleteExpiredCall(SEED_CLINIC_ID, boundaryId, cutoff)).toBe(false);
      expect(await tx.execute(query`SELECT id FROM calls WHERE id = ${expiredId}`)).toHaveLength(0);
      expect(await tx.execute(query`SELECT id FROM call_transcripts WHERE call_id = ${expiredId}`)).toHaveLength(0);
      expect(await tx.execute(query`SELECT id FROM patients WHERE id = ${patientId}`)).toHaveLength(1);
      expect(await tx.execute(query`SELECT id FROM appointment_requests WHERE id = ${appointmentId} AND status = 'confirmed'`)).toHaveLength(1);
      for (const [table, id] of [
        ['callback_requests', callbackId], ['emergency_incidents', emergencyId],
        ['appointment_action_requests', actionId],
      ] as const) {
        const rows = await tx.execute(query`SELECT id FROM ${query.identifier(table)}
          WHERE id = ${id} AND clinic_id = ${SEED_CLINIC_ID} AND source_call_id IS NULL`);
        expect(rows).toHaveLength(1);
      }
      // No test fixture or deletion is committed to the shared test database.
      throw rollback;
    })).rejects.toBe(rollback);
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
