import { Inject, Injectable } from '@nestjs/common';
import { type ApiEnv } from '@vaidya/config';
import { DatabaseService } from '@vaidya/db';
import { AppError } from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';
import { BullMQQueueService } from '../../common/queue/bullmq-queue.service';

export interface InfraHealthStatus {
  database: 'ok' | 'error';
  queue_mode: ApiEnv['QUEUE_MODE'];
  redis_connected: boolean | null;
  worker_enabled: boolean;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(BullMQQueueService) private readonly bullmqQueueService: BullMQQueueService,
  ) {}

  async getInfraStatus(): Promise<InfraHealthStatus> {
    const database = await this.checkDatabase();
    const redisConnected =
      this.env.QUEUE_MODE === 'bullmq' ? await this.checkRedisConnection() : null;

    return {
      database,
      queue_mode: this.env.QUEUE_MODE,
      redis_connected: redisConnected,
      worker_enabled: this.env.JOB_WORKER_ENABLED,
    };
  }

  private async checkDatabase(): Promise<'ok' | 'error'> {
    try {
      await this.databaseService.findClinicById('00000000-0000-0000-0000-000000000001');
      return 'ok';
    } catch (error) {
      if (error instanceof AppError && error.code === 'CLINIC_NOT_FOUND') {
        return 'ok';
      }
      return 'error';
    }
  }

  private async checkRedisConnection(): Promise<boolean> {
    try {
      const connection = this.bullmqQueueService.getConnection();
      const result = await connection.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
