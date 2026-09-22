import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  type DatabaseConnection,
} from '../src/client';
import { ClinicalSetupRepository } from '../src/repositories';

describe('clinic service upsert query', () => {
  let connection: DatabaseConnection;
  let repository: ClinicalSetupRepository;

  beforeAll(() => {
    // Postgres.js is lazy, so compiling this query does not open a connection.
    connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
    repository = new ClinicalSetupRepository(connection.db);
  });

  afterAll(async () => {
    await closeDatabaseConnection(connection);
  });

  it('uses the clinic and service key uniqueness constraint without changing the key', () => {
    const query = repository
      .upsertClinicService({
        clinicId: '00000000-0000-0000-0000-000000000001',
        serviceKey: 'general_consultation',
        serviceName: 'General Consultation',
        active: true,
      })
      .toSQL();

    expect(query.sql).toContain('on conflict ("clinic_id","service_key") do update');
    expect(query.sql).toContain('"service_name" =');
    expect(query.sql).toContain('"active" =');
    expect(query.params).toContain('general_consultation');
    expect(query.params).toContain('General Consultation');
  });
});
