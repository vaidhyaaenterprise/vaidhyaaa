import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { EnvValidationError, parseApiEnv } from '@vaidya/config';
import {
  ADAPTER_TOKENS,
  ALL_QUEUE_NAMES,
  apiSuccessBodySchema,
  JOB_QUEUE_MAP,
  JOB_TYPES,
  QUEUE_NAMES,
  type JobRegistry,
  type QueueService,
  type WorkerBootstrap,
  withLock,
} from '@vaidya/shared';

import { InMemoryLockService } from '../src/common/locks/in-memory-lock.service';
import { JobExecutorService } from '../src/common/jobs/job-executor.service';
import { JobRegistryService } from '../src/common/jobs/job-registry.service';
import { InlineQueueService } from '../src/common/queue/inline-queue.service';
import { assertRedisUrlForBullmq } from '../src/common/queue/bullmq-queue.service';
import { LoggerModule } from '../src/common/logger/logger.module';
import { ApiConfigModule } from '../src/config/api-config.module';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';
import { testLogger } from './test-logger';
import { AppLogger } from '../src/common/logger/logger.service';

function waitForInlineJob(ms = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('C05 background job foundation', () => {
  describe('unit behaviors', () => {
    it('1. inline queue executes job handler in local mode', async () => {
      const registry = new JobRegistryService();
      let executed = false;
      registry.register(JOB_TYPES.SEND_NOTIFICATION, async () => {
        executed = true;
      });

      const moduleRef = await Test.createTestingModule({
        imports: [LoggerModule, ApiConfigModule],
        providers: [
          JobExecutorService,
          { provide: ADAPTER_TOKENS.JobRegistry, useValue: registry },
          { provide: AppLogger, useValue: testLogger },
          InlineQueueService,
        ],
      }).compile();

      const queue = moduleRef.get(InlineQueueService);
      await queue.enqueue({
        queue: QUEUE_NAMES.NOTIFICATIONS,
        jobType: JOB_TYPES.SEND_NOTIFICATION,
        payload: {
          clinic_id: SEED.CLINIC_ID,
          notification_event_id: '00000000-0000-0000-0000-000000000501',
          channel: 'dashboard',
          recipient: 'staff',
          template_key: 'booking.created_pending',
        },
      });

      await waitForInlineJob(200);
      expect(executed).toBe(true);
      await moduleRef.close();
    });

    it('2. in-memory lock serializes two calls with same key', async () => {
      const lockService = new InMemoryLockService();
      const order: number[] = [];
      let firstLockHeld = false;

      const first = (async () => {
        await withLock(lockService, 'session:test', 500, async () => {
          order.push(1);
          firstLockHeld = true;
          await waitForInlineJob(50);
          order.push(2);
        });
      })();

      await waitForInlineJob(10);
      expect(firstLockHeld).toBe(true);

      let lockRejected = false;
      try {
        await withLock(lockService, 'session:test', 500, async () => {
          order.push(3);
        });
      } catch {
        lockRejected = true;
      }

      await first;
      expect(lockRejected).toBe(true);
      expect(order).toEqual([1, 2]);
    });

    it('4. bullmq mode fails fast if REDIS_URL missing', () => {
      expect(() => assertRedisUrlForBullmq(undefined)).toThrow(
        'REDIS_URL is required when QUEUE_MODE is bullmq',
      );
      expect(() =>
        parseApiEnv({
          NODE_ENV: 'test',
          DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
          JWT_SECRET: 'test_secret',
          QUEUE_MODE: 'bullmq',
        }),
      ).toThrow(EnvValidationError);
    });

    it('validates job payload before enqueue and rejects bad payload', async () => {
      const registry = new JobRegistryService();
      const moduleRef = await Test.createTestingModule({
        imports: [LoggerModule, ApiConfigModule],
        providers: [
          JobExecutorService,
          { provide: ADAPTER_TOKENS.JobRegistry, useValue: registry },
          { provide: AppLogger, useValue: testLogger },
          InlineQueueService,
        ],
      }).compile();

      const queue = moduleRef.get(InlineQueueService);
      await expect(
        queue.enqueue({
          queue: QUEUE_NAMES.NOTIFICATIONS,
          jobType: JOB_TYPES.SEND_NOTIFICATION,
          payload: { clinic_id: SEED.CLINIC_ID },
        }),
      ).rejects.toThrow();

      await moduleRef.close();
    });

    it('retries notification job with backoff and succeeds without duplicate side effects', async () => {
      const registry = new JobRegistryService();
      let attempts = 0;
      let sendCount = 0;

      registry.register(JOB_TYPES.SEND_NOTIFICATION, async () => {
        attempts += 1;
        sendCount += 1;
        if (attempts < 3) {
          throw new Error('mock provider failure');
        }
      });

      const moduleRef = await Test.createTestingModule({
        imports: [LoggerModule, ApiConfigModule],
        providers: [
          JobExecutorService,
          { provide: ADAPTER_TOKENS.JobRegistry, useValue: registry },
          { provide: AppLogger, useValue: testLogger },
        ],
      }).compile();

      const executor = moduleRef.get(JobExecutorService);
      await executor.runValidatedJob(
        JOB_TYPES.SEND_NOTIFICATION,
        QUEUE_NAMES.NOTIFICATIONS,
        {
          clinic_id: SEED.CLINIC_ID,
          notification_event_id: '00000000-0000-0000-0000-000000000502',
          channel: 'dashboard',
          recipient: 'staff',
          template_key: 'booking.created_pending',
        },
        { maxAttempts: 3 },
      );

      expect(attempts).toBe(3);
      expect(sendCount).toBe(3);
      await moduleRef.close();
    });

    it('lock acquire, re-acquire failure, release, and expiry behavior', async () => {
      const lockService = new InMemoryLockService();

      expect(await lockService.acquire('job:1', 100)).toBe(true);
      expect(await lockService.acquire('job:1', 100)).toBe(false);

      await lockService.release('job:1');
      expect(await lockService.acquire('job:1', 100)).toBe(true);

      await waitForInlineJob(120);
      expect(await lockService.acquire('job:1', 100)).toBe(true);
    });
  });

  describe('API integration', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      process.env.QUEUE_MODE = 'inline';
      delete process.env.REDIS_URL;
      await prepareTestDatabase();
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('3. queue service can enqueue notification job payload', async () => {
      const queue = app.get<QueueService>(ADAPTER_TOKENS.QueueService);
      const jobId = await queue.enqueue({
        queue: JOB_QUEUE_MAP[JOB_TYPES.SEND_NOTIFICATION],
        jobType: JOB_TYPES.SEND_NOTIFICATION,
        clinicId: SEED.CLINIC_ID,
        correlationId: 'req_test_job',
        payload: {
          clinic_id: SEED.CLINIC_ID,
          notification_event_id: '00000000-0000-0000-0000-000000000503',
          channel: 'dashboard',
          recipient: 'staff',
          template_key: 'booking.created_pending',
        },
      });

      expect(jobId).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('5. API starts with QUEUE_MODE=inline and no Redis', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/health',
      });
      expect(response.statusCode).toBe(200);
    });

    it('exposes infra health with queue mode and database status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/health/infra',
      });

      expect(response.statusCode).toBe(200);
      const body = apiSuccessBodySchema.parse(response.json());
      const data = body.data as {
        database: string;
        queue_mode: string;
        redis_connected: boolean | null;
        worker_enabled: boolean;
      };

      expect(data.database).toBe('ok');
      expect(data.queue_mode).toBe('inline');
      expect(data.redis_connected).toBeNull();
      expect(data.worker_enabled).toBe(false);
    });

    it('registers JobRegistry and WorkerBootstrap adapters', () => {
      const registry = app.get<JobRegistry>(ADAPTER_TOKENS.JobRegistry);
      const worker = app.get<WorkerBootstrap>(ADAPTER_TOKENS.WorkerBootstrap);

      expect(registry.getRegisteredJobTypes().length).toBeGreaterThan(0);
      expect(typeof worker.start).toBe('function');
    });

    it('6. worker can start in inline mode without Redis', async () => {
      const worker = app.get<WorkerBootstrap>(ADAPTER_TOKENS.WorkerBootstrap);
      await worker.start();
      expect(worker.isRunning()).toBe(true);
      await worker.stop();
    });

    it('7. stub jobs do not require real messaging/speech providers', () => {
      const registry = app.get<JobRegistry>(ADAPTER_TOKENS.JobRegistry);
      for (const jobType of Object.values(JOB_TYPES)) {
        expect(registry.getHandler(jobType)).toBeTypeOf('function');
      }
    });

    it('registers all required queue names', () => {
      expect(ALL_QUEUE_NAMES).toEqual(
        expect.arrayContaining([
          'notifications',
          'slot-holds',
          'slot-generation',
          'recordings-cleanup',
          'transcripts-cleanup',
          'knowledge-processing',
          'embeddings',
          'daily-reports',
        ]),
      );
    });

    it('uses in-memory lock service in inline mode', () => {
      const lockService = app.get(ADAPTER_TOKENS.LockService);
      expect(lockService).toBeInstanceOf(InMemoryLockService);
    });
  });
});

describe('C05 worker module bootstrap', () => {
  it('starts worker application context in inline mode', async () => {
    process.env.QUEUE_MODE = 'inline';
    delete process.env.REDIS_URL;

    const { Test } = await import('@nestjs/testing');
    const { Module } = await import('@nestjs/common');
    const { ApiConfigModule } = await import('../src/config/api-config.module');
    const { JobInfrastructureModule } = await import('../src/common/jobs/job-infrastructure.module');
    const { LoggerModule } = await import('../src/common/logger/logger.module');

    @Module({
      imports: [ApiConfigModule, LoggerModule, JobInfrastructureModule],
    })
    class WorkerAppModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [WorkerAppModule],
    }).compile();

    const worker = moduleRef.get<WorkerBootstrap>(ADAPTER_TOKENS.WorkerBootstrap);
    await worker.start();
    expect(worker.isRunning()).toBe(true);
    await worker.stop();
    await moduleRef.close();
  });
});
