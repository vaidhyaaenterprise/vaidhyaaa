import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { type ApiEnv } from '@vaidya/config';
import IORedis from 'ioredis';

import { type RateLimitService } from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';
import { assertRedisUrlForBullmq } from '../queue/bullmq-queue.service';

@Injectable()
export class RedisRateLimitService implements RateLimitService, OnModuleDestroy {
  private connection: IORedis | null = null;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  private getRedisConnection(): IORedis {
    if (!this.connection) {
      const redisUrl = assertRedisUrlForBullmq(this.env.REDIS_URL);
      this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    }
    return this.connection;
  }

  async check(key: string, limit: number, windowMs: number): Promise<boolean> {
    const redisKey = `rate_limit:${key}`;
    const count = await this.getRedisConnection().incr(redisKey);
    if (count === 1) {
      await this.getRedisConnection().pexpire(redisKey, windowMs);
    }
    return count <= limit;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connection) {
      await this.connection.quit();
    }
  }
}
