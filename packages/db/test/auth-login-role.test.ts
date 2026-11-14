import { afterAll, describe, expect, it } from 'vitest';

import { closeDatabaseConnection, createDatabaseConnection } from '../src/client';
import { AuthRepository } from '../src/repositories/auth.repository';

// Compile the actual lookup SQL without opening a database connection.
const connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
afterAll(() => closeDatabaseConnection(connection));

describe('password login role lookup', () => {
  it.each(['doctor', 'clinic_admin'] as const)(
    'filters shared username/email matches by active %s membership before choosing an account',
    (role) => {
      const query = new AuthRepository(connection.db)
        .findUserByUsernameOrEmail(' Shared@example.test ', role)
        .toSQL();
      expect(query.sql).toContain('exists (select');
      expect(query.sql).toContain('"clinic_users"."user_id" = "users"."id"');
      expect(query.sql).toContain('"clinic_users"."role" =');
      expect(query.sql).toContain('"clinic_users"."active" =');
      expect(query.sql).toContain('"clinic_users"."deleted_at" is null');
      expect(query.params).toEqual(['shared@example.test', 'shared@example.test', role, true, 1]);
    },
  );

  it('keeps legacy username/email login available when no role is specified', () => {
    const query = new AuthRepository(connection.db).findUserByUsernameOrEmail('admin').toSQL();
    expect(query.sql).not.toContain('exists');
    expect(query.params).toEqual(['admin', 'admin', 1]);
  });
});
