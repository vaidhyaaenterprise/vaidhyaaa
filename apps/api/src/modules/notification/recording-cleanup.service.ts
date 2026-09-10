import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import { ADAPTER_TOKENS, type ObjectStorageProvider } from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';

@Injectable()
export class RecordingCleanupService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(ADAPTER_TOKENS.ObjectStorageProvider)
    private readonly objectStorage: ObjectStorageProvider,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async cleanupExpiredRecordings(input: { clinicId?: string; batchLimit?: number } = {}) {
    const rows = await this.repos.platformOps.listExpiredRecordings(
      input.clinicId,
      input.batchLimit ?? 100,
    );

    let deleted = 0;
    for (const call of rows) {
      if (call.recordingStorageKey) {
        await this.objectStorage.delete(call.recordingStorageKey);
      }
      await this.repos.platformOps.markRecordingDeleted(call.clinicId, call.id);
      deleted += 1;
    }

    return { deleted };
  }
}
