import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  type DatabaseConnection,
} from '../src/client';
import { AppointmentLifecycleRepository } from '../src/repositories';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const DOCTOR_ID = '00000000-0000-0000-0000-000000000201';

describe('appointment conflict detail queries', () => {
  let connection: DatabaseConnection;
  let repository: AppointmentLifecycleRepository;

  beforeAll(() => {
    // Postgres.js is lazy, so compiling these queries does not open a connection.
    connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
    repository = new AppointmentLifecycleRepository(connection.db);
  });

  afterAll(async () => {
    await closeDatabaseConnection(connection);
  });

  it('loads doctor and service names with tenant-scoped joins for future appointments', () => {
    const query = repository.listFutureActiveAppointments(CLINIC_ID, DOCTOR_ID).toSQL();

    expect(query.sql).toContain('left join "doctors"');
    expect(query.sql).toContain('left join "clinic_services"');
    expect(query.sql).toContain('"doctors"."clinic_id" = "appointment_requests"."clinic_id"');
    expect(query.sql).toContain(
      '"clinic_services"."clinic_id" = "appointment_requests"."clinic_id"',
    );
    expect(query.sql).toContain('"doctors"."name"');
    expect(query.sql).toContain('"clinic_services"."service_name"');
    expect(query.params).toContain(CLINIC_ID);
    expect(query.params).toContain(DOCTOR_ID);
  });

  it('uses the same enriched tenant-scoped projection for holiday conflicts', () => {
    const query = repository
      .listActiveAppointmentsOnDate(CLINIC_ID, '2026-09-21', [DOCTOR_ID])
      .toSQL();

    expect(query.sql).toContain('left join "doctors"');
    expect(query.sql).toContain('left join "clinic_services"');
    expect(query.sql).toContain('"doctors"."clinic_id" = "appointment_requests"."clinic_id"');
    expect(query.sql).toContain(
      '"clinic_services"."clinic_id" = "appointment_requests"."clinic_id"',
    );
    expect(query.params).toContain(CLINIC_ID);
    expect(query.params).toContain('2026-09-21');
    expect(query.params).toContain(DOCTOR_ID);
  });
});
