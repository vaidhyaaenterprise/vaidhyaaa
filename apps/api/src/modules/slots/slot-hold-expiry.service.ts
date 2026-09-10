import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

@Injectable()
export class SlotHoldExpiryService {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async expireSlotHolds(input: { clinicId?: string; batchLimit?: number } = {}) {
    const expired = await this.repos.slots.expireDueHolds(input.clinicId, input.batchLimit ?? 100);
    const released = await this.repos.slots.releaseSessionHolds(input.clinicId);
    return {
      expired_count: expired.length,
      released_count: released.length,
    };
  }
}
