import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDatabaseConnection, createDatabaseConnection } from '../src/client';
import { SlotsRepository } from '../src/repositories';
import { DatabaseService } from '../src/services/database.service';
import { appointmentSlots } from '../src/schema';
import { sql } from 'drizzle-orm';
type Sql = ReturnType<typeof sql>;
const connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
afterAll(() => closeDatabaseConnection(connection));

describe('slot configuration freshness', () => {
  it('checks the effective rule again inside the booking transaction', async () => {
    let query = '';
    const tx = {
      execute: vi.fn().mockResolvedValue([]),
      select: () => ({
        from: () => ({
          where: (predicate: Sql) => {
            query = connection.db.select().from(appointmentSlots).where(predicate).toSQL().sql;
            return { for: () => ({ limit: async () => [] }) };
          },
        }),
      }),
    };
    const database = new DatabaseService({
      transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
    } as never);
    await expect(
      database.withSlotForUpdate('clinic-1', 'stale-slot', async () => undefined),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
    expect(query).toContain('candidate.effective_from <= date("appointment_slots"."start_time")');
    expect(query).toContain('effective_rule.slot_duration_minutes');
    expect(query).toContain('effective_rule.capacity_per_slot');
  });

  it('looks up the rule for the requested date rather than the newest future configuration', () => {
    const query = new SlotsRepository(connection.db)
      .findEffectiveBookingRuleForDate('clinic-1', 'doctor-1', 'service-1', '2026-10-27')
      .toSQL();
    expect(query.sql).toContain('"effective_from" <=');
    expect(query.sql).toContain('"effective_to" >=');
    expect(query.sql).toContain('"version" desc');
    expect(query.params).toContain('2026-10-27');
  });

  it('locks existing generation windows until replacement commits', () => {
    const repo = new SlotsRepository(connection.db);
    const query = repo
      .listExistingSlotWindows(
        'clinic-1',
        'doctor-1',
        'service-1',
        '2026-10-23 00:00:00',
        '2026-10-25 23:59:59',
      )
      .toSQL();
    expect(query.sql).toContain('for update');
    expect(query.sql).toContain('"appointment_slots"."status" <>');
  });

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
      expect(sql).toContain("refresh.status IN ('pending', 'processing', 'failed')");
      expect(sql).toContain("refresh.payload_json->>'doctorId'");
      expect(sql).toContain('"appointment_slots"."clinic_id"');
      expect(sql).toContain('candidate.effective_from <= date("appointment_slots"."start_time")');
      expect(sql).toContain('candidate.effective_to >= date("appointment_slots"."start_time")');
      expect(sql).toContain('ORDER BY candidate.version DESC');
      expect(sql).toContain('effective_rule.slot_duration_minutes');
      expect(sql).toContain('effective_rule.capacity_per_slot');
    }
  });
});
