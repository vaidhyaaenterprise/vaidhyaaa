import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  backgroundJobs,
  createRepositories,
  eq,
  and,
  sql,
  type DatabaseConnection,
  type Repositories,
} from '@vaidya/db';
import { DATABASE_CONNECTION } from '../database/database.module';
import { AppLogger } from '../../common/logger/logger.service';
import { SlotGenerationService } from './slot-generation.service';

export const SLOT_RECONCILIATION_JOB = 'RECONCILE_SLOTS';
export type SlotReconciliationScope = {
  doctorId?: string;
  clinicServiceId?: string;
  ruleChange?: { ruleId: string; durationChanged: boolean; implementFrom?: string };
};

/** Transactional outbox: a successful save always has a durable, retryable slot update. */
@Injectable()
export class SlotReconciliationService implements OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection,
    @Inject(SlotGenerationService) private readonly generation: SlotGenerationService,
    @Inject(AppLogger) private readonly logger: AppLogger,
  ) {}

  async save<T>(
    clinicId: string,
    scope: SlotReconciliationScope,
    mutate: (repos: Repositories) => Promise<T>,
  ): Promise<T> {
    return this.connection.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`clinic-schedule:${clinicId}`}))`,
      );
      const result = await mutate(createRepositories(tx));
      await tx
        .insert(backgroundJobs)
        .values({ clinicId, jobType: SLOT_RECONCILIATION_JOB, payloadJson: scope, maxAttempts: 5 });
      return result;
    });
  }

  async enqueue(clinicId: string, scope: SlotReconciliationScope = {}) {
    await this.save(clinicId, scope, async () => undefined);
  }

  async pendingCount(clinicId: string) {
    const [row] = await this.connection.db
      .select({ count: sql<number>`count(*)::int` })
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.clinicId, clinicId),
          eq(backgroundJobs.jobType, SLOT_RECONCILIATION_JOB),
          sql`${backgroundJobs.status} IN ('pending', 'running')`,
        ),
      );
    return row?.count ?? 0;
  }

  async retryFailed() {
    await this.connection.db
      .update(backgroundJobs)
      .set({
        status: 'pending',
        attemptCount: 0,
        scheduledAt: new Date(),
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(backgroundJobs.jobType, SLOT_RECONCILIATION_JOB),
          eq(backgroundJobs.status, 'failed'),
        ),
      );
  }

  // The standalone worker recovers jobs even if the originating request/process disappears.
  startWorker() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.drain().catch((error: unknown) => {
        this.logger.error(String(error), undefined, 'SlotReconciliation');
      });
    }, 5_000);
    void this.drain().catch((error: unknown) => {
      this.logger.error(String(error), undefined, 'SlotReconciliation');
    });
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async drain(clinicId?: string, limit = 10): Promise<number> {
    let processed = 0;
    for (; processed < limit; processed++) {
      const owner = randomUUID();
      const job = await this.claim(owner, clinicId);
      if (!job) break;
      try {
        const scope = job.payloadJson as SlotReconciliationScope;
        const repos = createRepositories(this.connection.db);
        if (scope.ruleChange) {
          const [rule] = await repos.slots.findBookingRule(job.clinicId!, scope.ruleChange.ruleId);
          if (rule) {
            if (scope.ruleChange.durationChanged) {
              await repos.slots.supersedeFutureOpenSlots(
                job.clinicId!,
                rule.id,
                scope.ruleChange.implementFrom,
              );
            }
            await repos.slots.updateFutureOpenSlotCapacity(
              job.clinicId!,
              rule.id,
              rule.capacityPerSlot,
              rule.version,
              scope.ruleChange.implementFrom,
            );
          }
        }
        // Read current settings rather than replaying a stale schedule snapshot.
        await this.generation.generateSlots({
          clinicId: job.clinicId!,
          ...(scope.doctorId ? { doctorId: scope.doctorId } : {}),
          ...(scope.clinicServiceId ? { clinicServiceId: scope.clinicServiceId } : {}),
        });
        await this.connection.db
          .update(backgroundJobs)
          .set({
            status: 'completed',
            completedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(and(eq(backgroundJobs.id, job.id), eq(backgroundJobs.lockedBy, owner)));
      } catch (error) {
        const exhausted = job.attemptCount >= job.maxAttempts;
        await this.connection.db
          .update(backgroundJobs)
          .set({
            status: exhausted ? 'failed' : 'pending',
            scheduledAt: new Date(Date.now() + Math.min(300_000, 5_000 * 2 ** job.attemptCount)),
            lockedAt: null,
            lockedBy: null,
            lastError: error instanceof Error ? error.message : String(error),
            updatedAt: new Date(),
          })
          .where(and(eq(backgroundJobs.id, job.id), eq(backgroundJobs.lockedBy, owner)));
        this.logger.error(
          `Slot update ${job.id} failed (attempt ${job.attemptCount}).`,
          error instanceof Error ? error.stack : undefined,
          'SlotReconciliation',
        );
      }
    }
    return processed;
  }

  private async claim(owner: string, clinicId?: string) {
    return this.connection.db.transaction(async (tx) => {
      // Serialize short claims across instances; generation itself never holds this lock.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('slot-reconciliation-claim'))`);
      await tx.execute(sql`UPDATE background_jobs SET
        status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
        locked_by = NULL, locked_at = NULL, last_error = 'Worker interrupted before completing slot updates',
        updated_at = now() WHERE job_type = ${SLOT_RECONCILIATION_JOB}
        AND status = 'running' AND locked_at < now() - interval '10 minutes'`);
      const [job] = await tx
        .select()
        .from(backgroundJobs)
        .where(
          and(
            eq(backgroundJobs.jobType, SLOT_RECONCILIATION_JOB),
            eq(backgroundJobs.status, 'pending'),
            sql`${backgroundJobs.scheduledAt} <= now()`,
            ...(clinicId ? [eq(backgroundJobs.clinicId, clinicId)] : []),
            sql`NOT EXISTS (SELECT 1 FROM background_jobs busy WHERE busy.job_type = ${SLOT_RECONCILIATION_JOB}
          AND busy.clinic_id = ${backgroundJobs.clinicId} AND busy.status = 'running')`,
          ),
        )
        .orderBy(backgroundJobs.createdAt)
        .limit(1)
        .for('update', { skipLocked: true });
      if (!job) return undefined;
      const [claimed] = await tx
        .update(backgroundJobs)
        .set({
          status: 'running',
          lockedAt: new Date(),
          lockedBy: owner,
          attemptCount: job.attemptCount + 1,
          updatedAt: new Date(),
        })
        .where(eq(backgroundJobs.id, job.id))
        .returning();
      return claimed;
    });
  }
}
