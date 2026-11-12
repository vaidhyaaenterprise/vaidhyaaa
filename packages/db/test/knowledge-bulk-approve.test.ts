import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  type DatabaseConnection,
} from '../src/client';
import { KnowledgeRepository } from '../src/repositories';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const KNOWLEDGE_ID_1 = '00000000-0000-0000-0000-000000000501';
const KNOWLEDGE_ID_2 = '00000000-0000-0000-0000-000000000502';

describe('knowledge bulk approval query', () => {
  let connection: DatabaseConnection;
  let repository: KnowledgeRepository;

  beforeAll(() => {
    // Postgres.js is lazy, so compiling this query does not open a connection.
    connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
    repository = new KnowledgeRepository(connection.db);
  });

  afterAll(async () => {
    await closeDatabaseConnection(connection);
  });

  it('updates all candidates in one tenant-scoped query and matches validated answers', () => {
    const query = repository
      .bulkApproveKnowledgeEntries(
        CLINIC_ID,
        [
          { id: KNOWLEDGE_ID_1, answer: 'Parking is available near the clinic.' },
          { id: KNOWLEDGE_ID_2, answer: 'The clinic opens at 9 AM.' },
        ],
        '00000000-0000-0000-0000-000000000102',
      )
      .toSQL();

    expect(query.sql).toContain('update "clinic_knowledge_base"');
    expect(query.sql).toContain('"clinic_id" =');
    expect(query.sql.match(/"answer" =/g)).toHaveLength(2);
    expect(query.params).toEqual(
      expect.arrayContaining([
        CLINIC_ID,
        KNOWLEDGE_ID_1,
        KNOWLEDGE_ID_2,
        'Parking is available near the clinic.',
        'The clinic opens at 9 AM.',
      ]),
    );
  });
});
