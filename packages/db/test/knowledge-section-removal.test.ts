import { afterAll, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';

import { closeDatabaseConnection, createDatabaseConnection, type Database } from '../src/client';
import { KnowledgeRepository } from '../src/repositories';
import { clinicKnowledgeBase } from '../src/schema';

const connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
afterAll(() => closeDatabaseConnection(connection));

describe('knowledge section removal approval guard', () => {
  it('uses the same active, answered approval conditions as the template before archiving', async () => {
    let approvalQuery: { sql: string; params: unknown[] } | undefined;
    const where = vi.fn().mockResolvedValue([]);
    const returning = vi.fn().mockResolvedValue([{ sectionKey: 'facilities' }]);
    const transaction = {
      select: () => ({
        from: () => ({
          where: (condition: SQL) => ({
            limit: async (limit: number) => {
              approvalQuery = connection.db
                .select({ id: clinicKnowledgeBase.id })
                .from(clinicKnowledgeBase)
                .where(condition)
                .limit(limit)
                .toSQL();
              return [];
            },
          }),
        }),
      }),
      update: () => ({ set: () => ({ where }) }),
      insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning }) }) }),
    };
    const db = {
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
    } as unknown as Database;
    const repository = new KnowledgeRepository(db);

    await expect(repository.archiveKnowledgeSection({
      clinicId: '00000000-0000-0000-0000-000000000001',
      sectionKey: 'facilities',
      title: 'Facilities',
      active: false,
    })).resolves.toMatchObject({ blocked: false });

    expect(approvalQuery?.sql).toContain('"applicable" =');
    expect(approvalQuery?.sql).toContain('"qa_approved" =');
    expect(approvalQuery?.sql).toContain('"status" =');
    expect(approvalQuery?.sql).toContain('length(trim(');
    expect(approvalQuery?.sql).not.toContain(' or ');
    expect(approvalQuery?.params).toEqual([
      '00000000-0000-0000-0000-000000000001', 'facilities', true, 'approved', true, 1,
    ]);
    expect(where).toHaveBeenCalledOnce();
    expect(returning).toHaveBeenCalledOnce();
  });
});
