import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabaseConnection, createDatabaseConnection } from '../src/client';
import { ClinicsRepository } from '../src/repositories';

const connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
afterAll(() => closeDatabaseConnection(connection));

describe('clinic call-routing phone compatibility', () => {
  it.each(['9876543210', '+919876543210', '919876543210', '+91 98765 43210'])(
    'matches ten-digit and +91 storage for %s',
    (phone) => {
      const query = new ClinicsRepository(connection.db).findClinicByPhone(phone).toSQL();
      expect(query.params).toContain('9876543210');
      expect(query.params).toContain('919876543210');
      expect(query.params).toContain('+919876543210');
    },
  );
  it('does not strip the country code from unrelated international numbers', () => {
    const query = new ClinicsRepository(connection.db).findClinicByPhone('+441234567890').toSQL();
    expect(query.params).not.toContain('1234567890');
  });
});
