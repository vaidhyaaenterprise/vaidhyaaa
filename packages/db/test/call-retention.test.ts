import { afterAll, describe, expect, it, vi } from 'vitest';
import { getTableName, type SQL } from 'drizzle-orm';
import { closeDatabaseConnection, createDatabaseConnection, type Database } from '../src/client';
import { CallInboxRepository } from '../src/repositories/call-inbox.repository';
import { calls } from '../src/schema';

// Query compilation uses Postgres.js laziness; no live database is accessed.
const connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
afterAll(() => closeDatabaseConnection(connection));
const clinicId = '00000000-0000-0000-0000-000000000001';
const callId = '00000000-0000-0000-0000-000000000101';
const cutoff = new Date('2026-09-09T12:00:00Z');

describe('Call inbox retention queries', () => {
  it('filters and orders calls by started_at with a created_at fallback', () => {
    const query = new CallInboxRepository(connection.db)
      .listCalls(clinicId, {
        from: cutoff,
        to: new Date('2026-10-24T12:00:00Z'),
      })
      .toSQL();
    expect(query.sql).toContain('coalesce("calls"."started_at", "calls"."created_at") >=');
    expect(query.sql).toContain('coalesce("calls"."started_at", "calls"."created_at") <=');
    expect(query.params[0]).toBe(clinicId);
    expect(query.params).toEqual([clinicId, cutoff.toISOString(), '2026-10-24T12:00:00.000Z', 500]);
    expect(query.params.some((value) => value instanceof Date)).toBe(false);
  });

  it.each([
    { label: 'lower bound only', from: '2026-11-01T00:00:00+05:30' },
    { label: 'upper bound only', to: '2026-11-16T23:59:59.123+05:30' },
    { label: 'no date bounds' },
  ])('serializes $label without changing the instant or inventing a bound', (range) => {
    const from = 'from' in range ? new Date(range.from) : undefined;
    const to = 'to' in range ? new Date(range.to) : undefined;
    const query = new CallInboxRepository(connection.db)
      .listCalls(clinicId, {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      })
      .toSQL();
    expect(query.params).toEqual([
      clinicId,
      ...(from ? [from.toISOString()] : []),
      ...(to ? [to.toISOString()] : []),
      500,
    ]);
    expect(query.sql.includes(' >= ')).toBe(Boolean(from));
    expect(query.sql.includes(' <= ')).toBe(Boolean(to));
    expect(query.params.some((value) => value instanceof Date)).toBe(false);
  });

  it.each([
    'listCalls',
    'listVoiceAppointmentBookings',
    'listAppointmentCallActions',
    'listCallbackRequests',
    'listEmergencyIncidents',
    'listVoiceInquiryMessages',
  ] as const)('passes database-safe date parameters for the inbox source %s', (source) => {
    const from = new Date('2026-11-01T00:00:00+05:30');
    const to = new Date('2026-11-16T23:59:59.123+05:30');
    const query = new CallInboxRepository(connection.db)[source](clinicId, { from, to }).toSQL();
    expect(query.params).toContain(clinicId);
    expect(query.params).toContain(from.toISOString());
    expect(query.params).toContain(to.toISOString());
    // Raw Date values reach Postgres.js's text binding without the timestamp
    // column encoder when the comparison uses a computed SQL expression.
    expect(query.params.some((value) => value instanceof Date)).toBe(false);
  });

  it('selects only strictly older calls in bounded oldest-first clinic-scoped batches', () => {
    const query = new CallInboxRepository(connection.db)
      .listExpiredCalls(cutoff, 100, clinicId)
      .toSQL();
    expect(query.sql).toContain('coalesce("calls"."started_at", "calls"."created_at") <');
    expect(query.sql).not.toContain('<=');
    expect(query.sql).toContain('order by coalesce(');
    expect(query.sql).toContain('limit');
    expect(query.params).toEqual([cutoff.toISOString(), clinicId, 100]);
    expect(query.params.some((value) => value instanceof Date)).toBe(false);
  });

  it('serializes the retention cutoff for the scheduled all-clinic cleanup', () => {
    const query = new CallInboxRepository(connection.db).listExpiredCalls(cutoff, 100).toSQL();
    expect(query.params).toEqual([cutoff.toISOString(), 100]);
    expect(query.params.some((value) => value instanceof Date)).toBe(false);
  });

  it('locks the expired call and detaches references before deleting transcripts and the call atomically', async () => {
    const operations: string[] = [];
    const conditions: SQL[] = [];
    const patches: unknown[] = [];
    const tx = {
      select: () => ({
        from: () => ({
          where: (condition: SQL) => ({
            for: async (lock: string) => {
              operations.push(`lock:${lock}`);
              conditions.push(condition);
              return [{ id: callId }];
            },
          }),
        }),
      }),
      update: (table: Parameters<typeof getTableName>[0]) => ({
        set: (values: unknown) => ({
          where: async (condition: SQL) => {
            operations.push(`update:${getTableName(table)}`);
            conditions.push(condition);
            patches.push(values);
          },
        }),
      }),
      delete: (table: Parameters<typeof getTableName>[0]) => ({
        where: async (condition: SQL) => {
          operations.push(`delete:${getTableName(table)}`);
          conditions.push(condition);
        },
      }),
    };
    const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx),
    );
    const repository = new CallInboxRepository({ transaction } as unknown as Database);
    await expect(repository.deleteExpiredCall(clinicId, callId, cutoff)).resolves.toBe(true);
    expect(transaction).toHaveBeenCalledOnce();
    expect(operations).toEqual([
      'lock:update',
      'update:appointment_action_requests',
      'update:callback_requests',
      'update:emergency_incidents',
      'delete:call_transcripts',
      'delete:calls',
    ]);
    expect(patches).toEqual([
      { sourceCallId: null },
      { sourceCallId: null },
      { sourceCallId: null },
    ]);
    for (const condition of conditions) {
      const query = connection.db.select().from(calls).where(condition).toSQL();
      expect(query.params).toContain(clinicId);
      expect(query.params).toContain(callId);
      expect(query.params.some((value) => value instanceof Date)).toBe(false);
    }
    const lock = connection.db.select().from(calls).where(conditions[0]).toSQL();
    const final = connection.db.select().from(calls).where(conditions.at(-1)).toSQL();
    expect(final.sql).toContain('coalesce("calls"."started_at", "calls"."created_at") <');
    expect(lock.params).toEqual([clinicId, callId, cutoff.toISOString()]);
    expect(final.params).toEqual(lock.params);
  });

  it('does not touch related data when the call is absent or no longer expired', async () => {
    const update = vi.fn();
    const remove = vi.fn();
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ for: async () => [] }) }) }),
      update,
      delete: remove,
    };
    const repository = new CallInboxRepository({
      transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as Database);
    await expect(repository.deleteExpiredCall(clinicId, callId, cutoff)).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
