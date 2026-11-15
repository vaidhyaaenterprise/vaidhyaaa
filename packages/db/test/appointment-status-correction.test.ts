import { afterAll, describe, expect, it } from 'vitest';

import { closeDatabaseConnection, createDatabaseConnection } from '../src/client';
import { AppointmentLifecycleRepository } from '../src/repositories/appointment-lifecycle.repository';
import { ClinicalSetupRepository } from '../src/repositories/clinical-setup.repository';

const connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
afterAll(() => closeDatabaseConnection(connection));

describe('appointment status correction queries', () => {
  it('updates only the status and modification timestamp of the clinic-scoped appointment', () => {
    const query = new AppointmentLifecycleRepository(connection.db)
      .setCorrectedStatus('clinic-1', 'appointment-1', 'visited')
      .toSQL();
    const setClause = query.sql.split(' where ')[0];
    expect(setClause).toContain('set "status" =');
    expect(setClause).toContain('"updated_at" =');
    expect(setClause).not.toContain('patient_name');
    expect(setClause).not.toContain('appointment_start');
    expect(setClause).not.toContain('reason_for_visit');
    expect(query.sql).toContain('"appointment_requests"."clinic_id" =');
    expect(query.sql).toContain('"appointment_requests"."id" =');
    expect(query.params[0]).toBe('visited');
    expect(query.params.slice(-2)).toEqual(['clinic-1', 'appointment-1']);
  });

  it('reads the current linked appointment status without dropping standalone clinical visits', () => {
    const lookup = new ClinicalSetupRepository(connection.db).listVisitsForPatientHistory(
      'clinic-1',
      ['patient-1'],
    );
    if (!('toSQL' in lookup)) throw new Error('Expected a query for a nonempty patient list');
    const query = lookup.toSQL();
    expect(query.sql).toContain('left join "appointment_requests"');
    expect(query.sql).toContain('"appointment_requests"."status"');
    expect(query.sql).toContain(
      '"appointment_requests"."clinic_id" = "patient_visits"."clinic_id"',
    );
    expect(query.sql).toContain(
      '"appointment_requests"."id" = "patient_visits"."appointment_request_id"',
    );
    expect(query.params).toEqual(['clinic-1', 'patient-1']);
  });
});
