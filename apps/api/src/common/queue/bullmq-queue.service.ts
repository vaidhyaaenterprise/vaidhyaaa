import { randomUUID } from 'node:crypto';

import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { type ApiEnv } from '@vaidya/config';
import { Job, Queue, Worker, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';

import {
  ALL_QUEUE_NAMES,
  ADAPTER_TOKENS,
  type EnqueueJobInput,
  type JobExecutionContext,
  type JobRegistry,
  type QueueService,
  validateJobPayload,
} from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';
import { AppLogger } from '../logger/logger.service';

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 1000,
  },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export function assertRedisUrlForBullmq(redisUrl: string | undefined): string {
  if (!redisUrl) {
    throw new Error('REDIS_URL is required when QUEUE_MODE is bullmq');
  }
  return redisUrl;
}

@Injectable()
export class BullMQQueueService implements QueueService, OnModuleDestroy {
  private connection: IORedis | null = null;
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(ADAPTER_TOKENS.JobRegistry) private readonly registry: JobRegistry,
    @Inject(AppLogger) private readonly logger: AppLogger,
  ) {}

  private getRedisConnection(): IORedis {
    if (!this.connection) {
      const redisUrl = assertRedisUrlForBullmq(this.env.REDIS_URL);
      this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    }
    return this.connection;
  }

  getConnection(): IORedis {
    return this.getRedisConnection();
  }

  isRedisConnected(): boolean {
    return this.connection?.status === 'ready';
  }

  getQueue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.getRedisConnection() as unknown as ConnectionOptions,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async enqueue(job: EnqueueJobInput): Promise<string> {
    validateJobPayload(job.jobType, job.payload);
    const jobId = job.jobId ?? randomUUID();
    const queue = this.getQueue(job.queue);

    await queue.add(
      job.jobType,
      {
        payload: job.payload,
        correlationId: job.correlationId,
        clinicId: job.clinicId,
      },
      {
        jobId,
        ...DEFAULT_JOB_OPTIONS,
      },
    );

    this.logger.log(
      JSON.stringify({
        event: 'job_enqueued_bullmq',
        job_id: jobId,
        job_type: job.jobType,
        queue: job.queue,
        correlation_id: job.correlationId,
        clinic_id: job.clinicId,
      }),
      'BullMQQueueService',
    );

    return jobId;
  }

  registerWorker(queueName: string): Worker {
    const existing = this.workers.get(queueName);
    if (existing) {
      return existing;
    }

    const worker = new Worker(
      queueName,
      async (bullJob: Job) => {
        const handler = this.registry.getHandler(bullJob.name);
        if (!handler) {
          throw new Error(`No handler registered for job type: ${bullJob.name}`);
        }

        const payload = (bullJob.data?.payload ?? {}) as Record<string, unknown>;
        const validatedPayload = validateJobPayload(bullJob.name, payload);
        const context: JobExecutionContext = {
          jobId: bullJob.id ?? randomUUID(),
          jobType: bullJob.name,
          queue: queueName,
          attempt: bullJob.attemptsMade + 1,
          ...(bullJob.data?.correlationId
            ? { correlationId: bullJob.data.correlationId as string }
            : {}),
          ...(bullJob.data?.clinicId ? { clinicId: bullJob.data.clinicId as string } : {}),
        };

        await handler(validatedPayload, context);
      },
      {
        connection: this.getRedisConnection() as unknown as ConnectionOptions,
      },
    );

    worker.on('failed', (bullJob, error) => {
      this.logger.error(
        JSON.stringify({
          event: 'bullmq_job_failed',
          job_id: bullJob?.id,
          job_type: bullJob?.name,
          queue: queueName,
          attempts: bullJob?.attemptsMade,
          error: error.message,
        }),
        error.stack,
        'BullMQQueueService',
      );
    });

    this.workers.set(queueName, worker);
    return worker;
  }

  ensureAllQueuesRegistered(): void {
    for (const queueName of ALL_QUEUE_NAMES) {
      this.getQueue(queueName);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.workers.values()].map((worker) => worker.close()));
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    if (this.connection) {
      await this.connection.quit();
    }
  }
}
