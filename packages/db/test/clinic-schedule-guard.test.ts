import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabaseConnection, createDatabaseConnection } from '../src/client';
import { ClinicalSetupRepository } from '../src/repositories';

const connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
afterAll(() => closeDatabaseConnection(connection));

describe('clinic hours doctor-schedule guard', () => {
  it('scopes to active clinic doctors and non-expired schedules using the clinic timezone', () => {
    const query = new ClinicalSetupRepository(connection.db)
      .listActiveDoctorScheduleWindows('00000000-0000-0000-0000-000000000001').toSQL();
    expect(query.sql).toContain('"doctor_schedules"."clinic_id" =');
    expect(query.sql).toContain('"doctor_schedules"."active" =');
    expect(query.sql).toContain('"doctors"."active" =');
    expect(query.sql).toContain('"effective_to" is null');
    expect(query.sql).toContain('current_timestamp at time zone "clinics"."timezone"');
    expect(query.params).toEqual(['00000000-0000-0000-0000-000000000001', true, true]);
  });
});
