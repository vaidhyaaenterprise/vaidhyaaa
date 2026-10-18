import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabaseConnection, createDatabaseConnection } from '../src/client';
import { SlotsRepository } from '../src/repositories';
const connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
afterAll(() => closeDatabaseConnection(connection));

describe('slot configuration freshness', () => {
  it('excludes stale slots in all availability lookup paths without affecting other doctors', () => {
    const repo = new SlotsRepository(connection.db);
    for (const query of [
      repo.findOpenSlot('clinic-1', 'slot-1'),
      repo.findSlotWindow(
        'clinic-1',
        'doctor-1',
        'service-1',
        '2026-10-20 09:00:00',
        '2026-10-20 09:15:00',
      ),
      repo.listAvailableOpenSlots('clinic-1', 'doctor-1', 'service-1'),
      repo.findSlotByExactTime('clinic-1', 'doctor-1', 'service-1', '2026-10-20', '09:00'),
    ]) {
      const { sql } = query.toSQL();
      expect(sql).toContain("refresh.job_type = 'RECONCILE_SLOTS'");
      expect(sql).toContain("refresh.status IN ('pending', 'running', 'failed')");
      expect(sql).toContain("refresh.payload_json->>'doctorId'");
      expect(sql).toContain('"appointment_slots"."clinic_id"');
    }
  });
});
