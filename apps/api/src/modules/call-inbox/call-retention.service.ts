import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { createRepositories, type DatabaseConnection, type Repositories } from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  AppError,
  CALL_HISTORY_RETENTION_DAYS,
  JOB_TYPES,
  type JobRegistry,
  type ObjectStorageProvider,
} from '@vaidya/shared';
import { DATABASE_CONNECTION } from '../database/database.module';

@Injectable()
export class CallRetentionService implements OnModuleInit {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(ADAPTER_TOKENS.ObjectStorageProvider) private readonly storage: ObjectStorageProvider,
    @Inject(ADAPTER_TOKENS.JobRegistry) private readonly registry: JobRegistry,
  ) {
    this.repos = createRepositories(connection.db);
  }

  onModuleInit(): void {
    this.registry.register(JOB_TYPES.CLEANUP_EXPIRED_CALLS, async (payload) => {
      await this.cleanup(typeof payload.clinic_id === 'string' ? payload.clinic_id : undefined);
    });
  }

  async cleanup(clinicId?: string) {
    const started = Date.now();
    const cutoff = new Date(started - CALL_HISTORY_RETENTION_DAYS * 86_400_000);
    let deleted = 0;
    let failed = 0;
    // Bounded work for serverless; a failure response makes an unfinished run
    // visible to the scheduler, and BullMQ retries it rather than claiming success.
    while (Date.now() - started < 20_000) {
      const rows = await this.repos.callInbox.listExpiredCalls(cutoff, 100, clinicId);
      if (rows.length === 0) return { deleted, retention_days: CALL_HISTORY_RETENTION_DAYS };
      for (const call of rows) {
        if (Date.now() - started >= 20_000) break;
        try {
          // Remove managed media first so deleting its database key cannot orphan it.
          if (call.recordingStorageKey && !call.recordingDeletedAt) {
            await this.storage.delete(call.recordingStorageKey);
          }
          if (await this.repos.callInbox.deleteExpiredCall(call.clinicId, call.id, cutoff))
            deleted++;
        } catch {
          failed++;
        }
      }
      if (failed > 0) break;
    }
    throw new AppError(
      'INTERNAL_ERROR',
      'Call-history cleanup is incomplete and must be retried.',
      {
        deleted,
        failed,
      },
    );
  }
}
