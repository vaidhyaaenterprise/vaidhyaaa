import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';

@Injectable()
export class TranscriptCleanupService {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async cleanupExpiredTranscripts(input: {
    clinicId?: string;
    retentionDays?: number;
    batchLimit?: number;
  } = {}) {
    const rows = await this.repos.platformOps.listExpiredTranscripts(
      input.clinicId,
      input.retentionDays ?? 30,
      input.batchLimit ?? 100,
    );

    let redacted = 0;
    for (const transcript of rows) {
      await this.repos.platformOps.redactTranscript(transcript.clinicId, transcript.id);
      redacted += 1;
    }

    return { redacted };
  }
}
