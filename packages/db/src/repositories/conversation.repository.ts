import { and, asc, eq } from 'drizzle-orm';

import type { Database } from '../client';
import {
  conversationMessages,
  conversationSessions,
  messageIdempotencyKeys,
} from '../schema';

export type ConversationSessionRow = typeof conversationSessions.$inferSelect;
export type ConversationMessageRow = typeof conversationMessages.$inferSelect;
export type MessageIdempotencyRow = typeof messageIdempotencyKeys.$inferSelect;

export class ConversationSessionRepository {
  constructor(private readonly db: Database) {}

  create(input: typeof conversationSessions.$inferInsert) {
    return this.db.insert(conversationSessions).values(input).returning();
  }

  findById(clinicId: string, sessionId: string) {
    return this.db
      .select()
      .from(conversationSessions)
      .where(and(eq(conversationSessions.clinicId, clinicId), eq(conversationSessions.id, sessionId)))
      .limit(1);
  }

  findBySessionId(sessionId: string) {
    return this.db
      .select()
      .from(conversationSessions)
      .where(eq(conversationSessions.id, sessionId))
      .limit(1);
  }

  update(
    clinicId: string,
    sessionId: string,
    values: Partial<typeof conversationSessions.$inferInsert>,
  ) {
    return this.db
      .update(conversationSessions)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(conversationSessions.clinicId, clinicId), eq(conversationSessions.id, sessionId)))
      .returning();
  }
}

export class ConversationMessageRepository {
  constructor(private readonly db: Database) {}

  create(input: typeof conversationMessages.$inferInsert) {
    return this.db.insert(conversationMessages).values(input).returning();
  }

  listBySession(clinicId: string, sessionId: string) {
    return this.db
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.clinicId, clinicId),
          eq(conversationMessages.sessionId, sessionId),
        ),
      )
      .orderBy(asc(conversationMessages.createdAt));
  }

  countBySession(clinicId: string, sessionId: string) {
    return this.listBySession(clinicId, sessionId);
  }
}

export class MessageIdempotencyRepository {
  constructor(private readonly db: Database) {}

  findByKey(clinicId: string, idempotencyKey: string) {
    return this.db
      .select()
      .from(messageIdempotencyKeys)
      .where(
        and(
          eq(messageIdempotencyKeys.clinicId, clinicId),
          eq(messageIdempotencyKeys.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
  }

  create(input: typeof messageIdempotencyKeys.$inferInsert) {
    return this.db.insert(messageIdempotencyKeys).values(input).returning();
  }
}
