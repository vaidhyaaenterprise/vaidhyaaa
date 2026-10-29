import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabaseConnection, createDatabaseConnection } from '../src/client';
import { ClinicalRepository } from '../src/repositories';

const connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
afterAll(() => closeDatabaseConnection(connection));
describe('Sarvam bookable doctor catalogue query', () => {
  it('enforces clinic scope and excludes inactive services, mappings and doctors without limiting to one doctor', () => {
    const query = new ClinicalRepository(connection.db)
      .listActiveDoctorServices('clinic-1')
      .toSQL();
    expect(query.sql).toContain('"doctor_services"."clinic_id" =');
    expect(query.sql).toContain('"doctor_services"."active" =');
    expect(query.sql).toContain('"doctors"."active" =');
    expect(query.sql).toContain('"clinic_services"."active" =');
    expect(query.sql).not.toContain('limit');
    expect(query.params).toEqual(['clinic-1', true, true, true]);
  });
});
