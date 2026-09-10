import { and, eq, inArray, lte, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { notificationEvents } from '../schema';

export type NotificationEventRow = typeof notificationEvents.$inferSelect;

export class NotificationRepository {
  constructor(private readonly db: Database) {}

  findById(clinicId: string, notificationEventId: string) {
    return this.db
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.clinicId, clinicId),
          eq(notificationEvents.id, notificationEventId),
        ),
      )
      .limit(1);
  }

  findByDeduplicationKey(clinicId: string, deduplicationKey: string) {
    return this.db
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.clinicId, clinicId),
          eq(notificationEvents.deduplicationKey, deduplicationKey),
        ),
      )
      .limit(1);
  }

  findSentByDeduplicationKey(clinicId: string, deduplicationKey: string) {
    return this.db
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.clinicId, clinicId),
          eq(notificationEvents.deduplicationKey, deduplicationKey),
          eq(notificationEvents.status, 'sent'),
        ),
      )
      .limit(1);
  }

  async insertWithDedup(values: typeof notificationEvents.$inferInsert) {
    if (values.deduplicationKey) {
      const existing = await this.findByDeduplicationKey(values.clinicId, values.deduplicationKey);
      if (existing.length > 0) {
        return existing;
      }
    }

    return this.db.insert(notificationEvents).values(values).returning();
  }

  async claimForProcessing(clinicId: string, notificationEventId: string) {
    const [row] = await this.db
      .update(notificationEvents)
      .set({
        status: 'processing',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notificationEvents.clinicId, clinicId),
          eq(notificationEvents.id, notificationEventId),
          inArray(notificationEvents.status, ['pending', 'failed']),
          lte(notificationEvents.scheduledAt, new Date()),
          sql`${notificationEvents.attemptCount} < ${notificationEvents.maxAttempts}`,
        ),
      )
      .returning();

    return row ?? null;
  }

  async markSent(
    clinicId: string,
    notificationEventId: string,
    providerResponse: Record<string, unknown>,
  ) {
    const [row] = await this.db
      .update(notificationEvents)
      .set({
        status: 'sent',
        sentAt: new Date(),
        providerResponseJson: providerResponse,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notificationEvents.clinicId, clinicId),
          eq(notificationEvents.id, notificationEventId),
        ),
      )
      .returning();

    return row ?? null;
  }

  async markFailed(input: {
    clinicId: string;
    notificationEventId: string;
    error: string;
    retryDelayMs?: number;
  }) {
    const [current] = await this.findById(input.clinicId, input.notificationEventId);
    if (!current) {
      return null;
    }

    const nextAttemptCount = current.attemptCount + 1;
    const isTerminal = nextAttemptCount >= current.maxAttempts;
    const retryDelayMs = input.retryDelayMs ?? 250 * 2 ** Math.max(current.attemptCount, 0);

    const [row] = await this.db
      .update(notificationEvents)
      .set({
        status: isTerminal ? 'failed' : 'pending',
        attemptCount: nextAttemptCount,
        lastError: input.error,
        scheduledAt: isTerminal ? current.scheduledAt : new Date(Date.now() + retryDelayMs),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notificationEvents.clinicId, input.clinicId),
          eq(notificationEvents.id, input.notificationEventId),
        ),
      )
      .returning();

    return row ?? null;
  }

  async markCancelled(clinicId: string, notificationEventId: string, reason: string) {
    const [row] = await this.db
      .update(notificationEvents)
      .set({
        status: 'cancelled',
        lastError: reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notificationEvents.clinicId, clinicId),
          eq(notificationEvents.id, notificationEventId),
        ),
      )
      .returning();

    return row ?? null;
  }

  async retryNotification(clinicId: string, notificationEventId: string) {
    const [row] = await this.db
      .update(notificationEvents)
      .set({
        status: 'pending',
        scheduledAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notificationEvents.clinicId, clinicId),
          eq(notificationEvents.id, notificationEventId),
          inArray(notificationEvents.status, ['failed', 'pending']),
        ),
      )
      .returning();

    return row ?? null;
  }

  findByIdGlobal(notificationEventId: string) {
    return this.db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.id, notificationEventId))
      .limit(1);
  }

  listPendingDue(limit = 50) {
    return this.db
      .select()
      .from(notificationEvents)
      .where(
        and(
          inArray(notificationEvents.status, ['pending', 'failed']),
          lte(notificationEvents.scheduledAt, new Date()),
          sql`${notificationEvents.attemptCount} < ${notificationEvents.maxAttempts}`,
        ),
      )
      .orderBy(notificationEvents.scheduledAt)
      .limit(limit);
  }

  listByClinicAndTypes(clinicId: string, eventTypes: string[]) {
    return this.db
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.clinicId, clinicId),
          inArray(notificationEvents.eventType, eventTypes),
        ),
      )
      .orderBy(notificationEvents.createdAt);
  }
}
