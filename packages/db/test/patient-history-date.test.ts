import { afterAll, describe, expect, it } from 'vitest';

import { closeDatabaseConnection, createDatabaseConnection } from '../src/client';
import { ClinicalSetupRepository } from '../src/repositories/clinical-setup.repository';

const connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
afterAll(() => closeDatabaseConnection(connection));

describe('patient history appointment-date query', () => {
  const repository = new ClinicalSetupRepository(connection.db);

  it('uses the complete clinic-local calendar day with an exclusive next-midnight boundary', () => {
    const query = repository
      .searchPatientsForHistory('clinic-1', { date: '2026-11-14', limit: 50 })
      .toSQL();
    expect(query.sql).toMatch(/appointment_start >= \$\d+::(?:date|timestamp)/);
    expect(query.sql).toMatch(/appointment_start < \$\d+::(?:date|timestamp) \+ interval '1 day'/);
    expect(query.params).toEqual(['clinic-1', '2026-11-14', '2026-11-14']);
    expect(query.sql).not.toMatch(/at time zone|visited_at|created_at/i);
  });

  it('matches patients through same-clinic appointments or an explicit linked visit', () => {
    const query = repository
      .searchPatientsForHistory('clinic-1', { date: '2026-11-14', limit: 50 })
      .toSQL();
    expect(query.sql).toContain('"patients"."clinic_id" =');
    expect(query.sql).toContain('history_appointment.clinic_id = "patients"."clinic_id"');
    expect(query.sql).toContain('history_appointment.patient_id = "patients"."id"');
    expect(query.sql).toContain('history_visit.clinic_id = "patients"."clinic_id"');
    expect(query.sql).toContain('history_visit.patient_id = "patients"."id"');
    expect(query.sql).toContain('history_visit.appointment_request_id = history_appointment.id');
    expect(query.sql).not.toContain('patient_phone');
  });

  it('returns one patient row for multiple appointments, without excluding statuses or capping the day at 50', () => {
    const query = repository
      .searchPatientsForHistory('clinic-1', { date: '2026-11-14', limit: 50 })
      .toSQL();
    expect(query.sql).toContain('from "patients" where');
    expect(query.sql).toMatch(/EXISTS \(\s*SELECT 1 FROM appointment_requests/i);
    expect(query.sql).not.toMatch(/\bjoin\b|\bstatus\b|\blimit\b/i);
    expect(query.params).not.toContain(50);
  });

  it('combines appointment date with phone, name, and age while retaining the broad-search limit when cleared', () => {
    const filters = { phone: '9876543210', name: 'aarti', age: 38, limit: 50 };
    const datedQuery = repository
      .searchPatientsForHistory('clinic-1', { ...filters, date: '2026-11-14' })
      .toSQL();
    expect(datedQuery.params).toEqual([
      'clinic-1',
      '9876543210',
      '%9876543210',
      '%aarti%',
      38,
      38,
      '2026-11-14',
      '2026-11-14',
    ]);
    expect(datedQuery.sql).not.toMatch(/\blimit\b/i);

    const undatedQuery = repository.searchPatientsForHistory('clinic-1', filters).toSQL();
    expect(undatedQuery.sql).toMatch(/\blimit \$\d+/i);
    expect(undatedQuery.sql).not.toContain('history_appointment');
    expect(undatedQuery.params.at(-1)).toBe(50);
  });
});
