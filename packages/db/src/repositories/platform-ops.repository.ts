import { and, eq, isNull, lt, lte, sql } from 'drizzle-orm';

import type { Database } from '../client';
import {
  callTranscripts,
  calls,
  clinicKnowledgeBase,
  knowledgeFiles,
} from '../schema';

export class PlatformOpsRepository {
  constructor(private readonly db: Database) {}

  listExpiredRecordings(clinicId?: string, limit = 100) {
    const conditions = [
      isNull(calls.recordingDeletedAt),
      lte(calls.recordingExpiresAt, new Date()),
      sql`${calls.recordingStorageKey} IS NOT NULL`,
    ];
    if (clinicId) {
      conditions.push(eq(calls.clinicId, clinicId));
    }

    return this.db
      .select()
      .from(calls)
      .where(and(...conditions))
      .limit(limit);
  }

  markRecordingDeleted(clinicId: string, callId: string) {
    return this.db
      .update(calls)
      .set({
        recordingDeletedAt: new Date(),
        recordingUrl: null,
        updatedAt: new Date(),
      })
      .where(and(eq(calls.clinicId, clinicId), eq(calls.id, callId)))
      .returning();
  }

  listExpiredTranscripts(clinicId?: string, retentionDays = 30, limit = 100) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const conditions = [lt(callTranscripts.createdAt, cutoff)];
    if (clinicId) {
      conditions.push(eq(callTranscripts.clinicId, clinicId));
    }

    return this.db
      .select()
      .from(callTranscripts)
      .where(and(...conditions))
      .limit(limit);
  }

  redactTranscript(clinicId: string, transcriptId: string) {
    return this.db
      .update(callTranscripts)
      .set({
        transcriptText: '[redacted]',
      })
      .where(and(eq(callTranscripts.clinicId, clinicId), eq(callTranscripts.id, transcriptId)))
      .returning();
  }

  findKnowledgeFile(clinicId: string, knowledgeFileId: string) {
    return this.db
      .select()
      .from(knowledgeFiles)
      .where(and(eq(knowledgeFiles.clinicId, clinicId), eq(knowledgeFiles.id, knowledgeFileId)))
      .limit(1);
  }

  updateKnowledgeFileStatus(
    clinicId: string,
    knowledgeFileId: string,
    status: string,
  ) {
    return this.db
      .update(knowledgeFiles)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(knowledgeFiles.clinicId, clinicId), eq(knowledgeFiles.id, knowledgeFileId)))
      .returning();
  }

  insertKnowledgeEntries(values: Array<typeof clinicKnowledgeBase.$inferInsert>) {
    if (values.length === 0) {
      return Promise.resolve([]);
    }
    return this.db.insert(clinicKnowledgeBase).values(values).returning();
  }

  insertKnowledgeFile(values: typeof knowledgeFiles.$inferInsert) {
    return this.db.insert(knowledgeFiles).values(values).returning();
  }

  listKnowledgeEntriesByClinic(clinicId: string, status?: string) {
    const conditions = [eq(clinicKnowledgeBase.clinicId, clinicId)];
    if (status) {
      conditions.push(eq(clinicKnowledgeBase.status, status));
    }
    return this.db
      .select()
      .from(clinicKnowledgeBase)
      .where(and(...conditions));
  }
}
