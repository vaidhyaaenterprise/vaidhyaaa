import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getAppliedMigrations,
  resetDatabase,
  runMigrations,
  runSeed,
} from '../src';
import {
  C04_ACTION_REQUEST_COLUMNS,
  C04_APPOINTMENT_REQUEST_COLUMNS,
  C04_APPOINTMENT_SLOT_COLUMNS,
  C04_BOOKING_RULE_COLUMNS,
  C04_REQUIRED_TABLES,
  C04_SLOT_HOLD_COLUMNS,
  SEED_CLINIC_ID,
  SEED_DOCTOR_WITHOUT_LOGIN_ID,
} from '../src/schema/schema-catalog';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/vaidya_test';

async function tableExists(sql: postgres.Sql, tableName: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS exists
  `;
  return rows[0]?.exists === true;
}

async function columnExists(
  sql: postgres.Sql,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS exists
  `;
  return rows[0]?.exists === true;
}

async function checkConstraintIncludes(
  sql: postgres.Sql,
  tableName: string,
  allowedValues: string[],
): Promise<boolean> {
  const rows = await sql<{ definition: string }[]>`
    SELECT pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = ${tableName}
      AND c.contype = 'c'
  `;

  const definitions = rows.map((row) => row.definition);
  return allowedValues.every((value) =>
    definitions.some((definition) => definition.includes(`'${value}'`)),
  );
}

describe('C04 final schema alignment', () => {
  let sql!: postgres.Sql;

  beforeAll(async () => {
    sql = postgres(TEST_DATABASE_URL, { max: 1 });
    await resetDatabase(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('1. fresh DB migration succeeds', async () => {
    const applied = await runMigrations(TEST_DATABASE_URL);
    expect(applied).toContain('001_initial_schema_production.sql');
    expect(applied).toContain('002_c04_schema_alignment.sql');
  });

  it('2. re-running migration is safe through normal migration system', async () => {
    const appliedAgain = await runMigrations(TEST_DATABASE_URL);
    expect(appliedAgain).toEqual([]);

    const status = await getAppliedMigrations(TEST_DATABASE_URL);
    expect(status.map((row) => row.name)).toEqual([
      '001_initial_schema_production.sql',
      '002_c04_schema_alignment.sql',
      '003_slot_clinic_local_timestamps.sql',
      '004_knowledge_embedding_metadata.sql',
      '005_patient_visit_examination_fields.sql',
      '006_patient_age_years.sql',
      '007_backfill_patient_normalized_name_age.sql',
      '008_doctor_specific_holidays.sql',
    ]);
  });

  it('3. seed data loads successfully', async () => {
    await expect(runSeed(TEST_DATABASE_URL)).resolves.toBeUndefined();
  });

  it('4. demo clinic has clinic_settings with agent_enabled=false', async () => {
    const [settings] = await sql<{ agent_enabled: boolean }[]>`
      SELECT agent_enabled FROM clinic_settings WHERE clinic_id = ${SEED_CLINIC_ID}::uuid
    `;
    expect(settings?.agent_enabled).toBe(false);
  });

  it('5. demo clinic has ta_tanglish default and english enabled', async () => {
    const [clinic] = await sql<{ default_language_code: string }[]>`
      SELECT default_language_code FROM clinics WHERE id = ${SEED_CLINIC_ID}::uuid
    `;
    expect(clinic?.default_language_code).toBe('ta_tanglish');

    const languages = await sql<{ language_code: string; enabled: boolean; is_default: boolean }[]>`
      SELECT language_code, enabled, is_default
      FROM clinic_languages
      WHERE clinic_id = ${SEED_CLINIC_ID}::uuid
      ORDER BY language_code
    `;

    expect(languages.some((row) => row.language_code === 'english' && row.enabled)).toBe(true);
    expect(languages.some((row) => row.language_code === 'ta_tanglish' && row.is_default)).toBe(
      true,
    );
  });

  it('6. demo doctor exists without requiring user_id', async () => {
    const [doctor] = await sql<{ user_id: string | null; name: string }[]>`
      SELECT user_id, name
      FROM doctors
      WHERE id = ${SEED_DOCTOR_WITHOUT_LOGIN_ID}::uuid
    `;
    expect(doctor?.user_id).toBeNull();
    expect(doctor?.name).toBe('Dr. Murugan');
  });

  it('7. doctor_service_booking_rules exists for demo doctor-service mapping', async () => {
    const rules = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM doctor_service_booking_rules
      WHERE clinic_id = ${SEED_CLINIC_ID}::uuid
        AND doctor_id = ${SEED_DOCTOR_WITHOUT_LOGIN_ID}::uuid
    `;
    expect(Number(rules[0]?.count)).toBeGreaterThan(0);
  });

  it('8. appointment_slots support capacity_total', async () => {
    for (const column of C04_APPOINTMENT_SLOT_COLUMNS) {
      expect(await columnExists(sql, 'appointment_slots', column)).toBe(true);
    }

    expect(await checkConstraintIncludes(sql, 'appointment_slots', ['open', 'superseded'])).toBe(
      true,
    );

    const invalidStatus = sql`
      INSERT INTO appointment_slots (
        clinic_id, doctor_id, clinic_service_id, start_time, end_time, capacity_total, status
      )
      VALUES (
        ${SEED_CLINIC_ID}::uuid,
        ${SEED_DOCTOR_WITHOUT_LOGIN_ID}::uuid,
        '00000000-0000-0000-0000-000000000301'::uuid,
        now() + interval '5 days',
        now() + interval '5 days 15 minutes',
        2,
        'booked'
      )
    `;

    await expect(invalidStatus).rejects.toMatchObject({ code: '23514' });
  });

  it('9. slot_holds table exists with required fields and statuses', async () => {
    expect(await tableExists(sql, 'slot_holds')).toBe(true);

    for (const column of C04_SLOT_HOLD_COLUMNS) {
      expect(await columnExists(sql, 'slot_holds', column)).toBe(true);
    }

    expect(await checkConstraintIncludes(sql, 'slot_holds', ['active', 'converted'])).toBe(true);
  });

  it('10. appointment_action_requests table exists with required fields', async () => {
    expect(await tableExists(sql, 'appointment_action_requests')).toBe(true);

    for (const column of C04_ACTION_REQUEST_COLUMNS) {
      expect(await columnExists(sql, 'appointment_action_requests', column)).toBe(true);
    }

    expect(
      await checkConstraintIncludes(sql, 'appointment_action_requests', ['cancel', 'reschedule']),
    ).toBe(true);
    expect(
      await checkConstraintIncludes(sql, 'appointment_action_requests', ['pending', 'completed']),
    ).toBe(true);
  });

  it('11. subscription tables exist and demo clinic has a subscription', async () => {
    for (const table of [
      'subscription_plans',
      'clinic_subscriptions',
      'clinic_usage_monthly',
      'subscription_events',
    ]) {
      expect(await tableExists(sql, table)).toBe(true);
    }

    const subscriptions = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM clinic_subscriptions
      WHERE clinic_id = ${SEED_CLINIC_ID}::uuid
    `;
    expect(Number(subscriptions[0]?.count)).toBeGreaterThan(0);
  });

  it('12. supported_languages and message_templates exist', async () => {
    expect(await tableExists(sql, 'supported_languages')).toBe(true);
    expect(await tableExists(sql, 'message_templates')).toBe(true);

    const languages = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM supported_languages
    `;
    expect(Number(languages[0]?.count)).toBeGreaterThanOrEqual(2);

    const templates = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM message_templates
    `;
    expect(Number(templates[0]?.count)).toBeGreaterThan(0);
  });

  it('includes all required production tables from the test pack', async () => {
    for (const table of C04_REQUIRED_TABLES) {
      expect(await tableExists(sql, table)).toBe(true);
    }
  });

  it('includes booking rule and appointment request columns from the test pack', async () => {
    for (const column of C04_BOOKING_RULE_COLUMNS) {
      expect(await columnExists(sql, 'doctor_service_booking_rules', column)).toBe(true);
    }

    for (const column of C04_APPOINTMENT_REQUEST_COLUMNS) {
      expect(await columnExists(sql, 'appointment_requests', column)).toBe(true);
    }
  });

  it('includes conversation session status index and background job polling index', async () => {
    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('idx_conversation_sessions_status', 'idx_background_jobs_poll')
    `;
    const names = indexes.map((row) => row.indexname);
    expect(names).toContain('idx_conversation_sessions_status');
    expect(names).toContain('idx_background_jobs_poll');
  });

  it('rejects cross-clinic doctor-service mapping', async () => {
    const otherClinicId = '00000000-0000-0000-0000-000000000099';
    const otherDoctorId = '00000000-0000-0000-0000-000000000299';

    await sql`
      INSERT INTO clinics (id, name, primary_phone, address_line1, city, state, country, timezone, default_language_code)
      VALUES (${otherClinicId}::uuid, 'Other Clinic', '+914400000099', 'Test', 'Chennai', 'TN', 'India', 'Asia/Kolkata', 'english')
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO doctors (id, clinic_id, name, qualification, active)
      VALUES (${otherDoctorId}::uuid, ${otherClinicId}::uuid, 'Dr Other', 'MBBS', true)
      ON CONFLICT (id) DO NOTHING
    `;

    await expect(
      sql`
        INSERT INTO doctor_services (clinic_id, doctor_id, clinic_service_id, active)
        VALUES (
          ${SEED_CLINIC_ID}::uuid,
          ${otherDoctorId}::uuid,
          '00000000-0000-0000-0000-000000000301'::uuid,
          true
        )
      `,
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('soft lifecycle columns exist on core entities', async () => {
    expect(await columnExists(sql, 'users', 'active')).toBe(true);
    expect(await columnExists(sql, 'clinic_users', 'active')).toBe(true);
    expect(await columnExists(sql, 'doctors', 'active')).toBe(true);
    expect(await columnExists(sql, 'clinic_services', 'active')).toBe(true);
    expect(await columnExists(sql, 'doctor_services', 'active')).toBe(true);
    expect(await columnExists(sql, 'clinic_knowledge_base', 'status')).toBe(true);
  });
});
