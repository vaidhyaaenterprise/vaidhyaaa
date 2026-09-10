import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { type ApiEnv } from '@vaidya/config';
import IORedis from 'ioredis';

import { type LockService } from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';
import { assertRedisUrlForBullmq } from '../queue/bullmq-queue.service';

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

@Injectable()
export class RedisLockService implements LockService, OnModuleDestroy {
  private connection: IORedis | null = null;
  private readonly tokens = new Map<string, string>();

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  private getRedisConnection(): IORedis {
    if (!this.connection) {
      const redisUrl = assertRedisUrlForBullmq(this.env.REDIS_URL);
      this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    }
    return this.connection;
  }

  isConnected(): boolean {
    return this.connection?.status === 'ready';
  }

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const token = `${Date.now()}:${Math.random()}`;
    const result = await this.getRedisConnection().set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
    if (result === 'OK') {
      this.tokens.set(key, token);
      return true;
    }
    return false;
  }

  async release(key: string): Promise<void> {
    const token = this.tokens.get(key);
    if (!token) {
      return;
    }

    await this.getRedisConnection().eval(RELEASE_SCRIPT, 1, `lock:${key}`, token);
    this.tokens.delete(key);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connection) {
      await this.connection.quit();
    }
  }
}
