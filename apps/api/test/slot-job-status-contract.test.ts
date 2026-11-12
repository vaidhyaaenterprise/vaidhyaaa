import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { backgroundJobs, closeDatabaseConnection, createDatabaseConnection, sql } from '@vaidya/db';
import { SlotReconciliationService } from '../src/modules/slots/slot-reconciliation.service';

// Compile the real claim/recovery queries without connecting to a live database.
const connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
afterAll(() => closeDatabaseConnection(connection));
const migration = readFileSync(
  resolve(__dirname, '../../../packages/db/migrations/002_c04_schema_alignment.sql'),
  'utf8',
);
const constraint = migration.match(
  /status text NOT NULL DEFAULT 'pending' CHECK \(status IN \(([^)]+)\)\)/,
)?.[1];
if (!constraint)
  throw new Error('Background job status constraint not found in baseline migration.');
const allowedStatuses = [...constraint.matchAll(/'([^']+)'/g)].map((match) => match[1]);
type Sql = ReturnType<typeof sql>;

describe('slot job status SQL contract', () => {
  it('keeps the typed schema aligned with the production check constraint', () => {
    expect(backgroundJobs.status.enumValues).toEqual(allowedStatuses);
    expect(allowedStatuses).toContain('processing');
    expect(allowedStatuses).not.toContain('running');
  });

  it('claims a real job with an allowed status before generating slots, then completes it', async () => {
    const queries: string[] = [];
    const statuses: string[] = [];
    const candidate = {
      id: '00000000-0000-0000-0000-000000000001',
      clinicId: '00000000-0000-0000-0000-000000000002',
      jobType: 'RECONCILE_SLOTS',
      payloadJson: {},
      attemptCount: 0,
      maxAttempts: 5,
    };
    let available = true;
    const update = () => ({
      set: (values: Partial<typeof backgroundJobs.$inferInsert>) => {
        expect(allowedStatuses).toContain(values.status);
        statuses.push(values.status!);
        return {
          where: (predicate: Sql | undefined) => {
            // Values are checked above; the production query builder is exercised
            // by the claim/filter SQL below, not by a second implementation of it.
            void predicate;
            const result = [{ ...candidate, ...values }];
            return Object.assign(Promise.resolve(result), { returning: async () => result });
          },
        };
      },
    });
    const tx = {
      execute: async (statement: Sql) => {
        const query = connection.db.select({ recovery: statement }).from(backgroundJobs).toSQL();
        queries.push(query.sql);
        return [];
      },
      select: () => ({
        from: () => ({
          where: (predicate: Sql | undefined) => {
            queries.push(connection.db.select().from(backgroundJobs).where(predicate).toSQL().sql);
            return {
              orderBy: () => ({
                limit: () => ({
                  for: async () => {
                    if (!available) return [];
                    available = false;
                    return [candidate];
                  },
                }),
              }),
            };
          },
        }),
      }),
      update,
    };
    const generateSlots = vi.fn().mockResolvedValue([]);
    const service = new SlotReconciliationService(
      {
        db: {
          transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
          update,
        },
      } as never,
      { generateSlots } as never,
      { error: vi.fn() } as never,
    );
    expect(await service.drain(candidate.clinicId)).toBe(1);
    expect(statuses).toEqual(['processing', 'completed']);
    expect(generateSlots).toHaveBeenCalledOnce();
    expect(queries.some((query) => query.includes("status = 'processing' AND locked_at"))).toBe(
      true,
    );
    expect(queries.some((query) => query.includes("busy.status = 'processing'"))).toBe(true);
    expect(queries.every((query) => !query.includes("'running'"))).toBe(true);
  });

  it('counts processing jobs as updating rather than reporting ready', async () => {
    const queries: string[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: (predicate: Sql | undefined) => {
            queries.push(connection.db.select().from(backgroundJobs).where(predicate).toSQL().sql);
            return Promise.resolve([{ status: 'processing' }]);
          },
        }),
      }),
    };
    const service = new SlotReconciliationService({ db } as never, {} as never, {} as never);
    await expect(service.status('clinic-1')).resolves.toEqual({
      state: 'updating',
      remaining: 1,
      failed: 0,
    });
    expect(queries[0]).toContain("IN ('pending', 'processing', 'failed')");
    expect(queries[0]).not.toContain("'running'");
  });
});
