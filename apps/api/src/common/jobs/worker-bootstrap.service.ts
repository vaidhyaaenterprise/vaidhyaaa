import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { type ApiEnv } from '@vaidya/config';

import {
  ALL_JOB_TYPES,
  ALL_QUEUE_NAMES,
  JOB_TYPES,
  type JobHandler,
  type JobRegistry,
  type JobType,
  type WorkerBootstrap,
  ADAPTER_TOKENS,
} from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';
import { AppLogger } from '../logger/logger.service';
import { BullMQQueueService } from '../queue/bullmq-queue.service';
import { BullMQSchedulerService } from '../scheduler/bullmq-scheduler.service';

const NON_STUB_JOB_TYPES = new Set<JobType>([
  JOB_TYPES.GENERATE_SLOTS,
  JOB_TYPES.EXPIRE_SLOT_HOLDS,
  JOB_TYPES.SEND_NOTIFICATION,
  JOB_TYPES.CLEANUP_EXPIRED_RECORDINGS,
  JOB_TYPES.CLEANUP_EXPIRED_TRANSCRIPTS,
  JOB_TYPES.PARSE_KNOWLEDGE_DOCX,
  JOB_TYPES.GENERATE_KNOWLEDGE_EMBEDDING,
  JOB_TYPES.GENERATE_DAILY_CLINIC_REPORT,
]);

function createStubHandler(jobType: string, logger: AppLogger): JobHandler {
  return async (payload, context) => {
    logger.log(
      JSON.stringify({
        event: 'job_stub_executed',
        job_type: jobType,
        job_id: context.jobId,
        clinic_id: context.clinicId ?? payload.clinic_id,
        correlation_id: context.correlationId,
        attempt: context.attempt,
      }),
      'DefaultJobHandlers',
    );
  };
}

@Injectable()
export class DefaultJobHandlersRegistrar implements OnModuleInit {
  constructor(
    @Inject(ADAPTER_TOKENS.JobRegistry) private readonly registry: JobRegistry,
    @Inject(AppLogger) private readonly logger: AppLogger,
  ) {}

  onModuleInit(): void {
    const stubJobTypes = ALL_JOB_TYPES.filter((jobType) => !NON_STUB_JOB_TYPES.has(jobType));

    for (const jobType of stubJobTypes) {
      this.registry.register(jobType, createStubHandler(jobType, this.logger));
    }
  }
}

@Injectable()
export class WorkerBootstrapService implements WorkerBootstrap {
  private running = false;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(ADAPTER_TOKENS.JobRegistry) private readonly registry: JobRegistry,
    @Inject(AppLogger) private readonly logger: AppLogger,
    @Inject(BullMQQueueService) private readonly bullmq: BullMQQueueService,
    @Inject(BullMQSchedulerService) private readonly bullmqScheduler: BullMQSchedulerService,
  ) {}

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    if (this.env.QUEUE_MODE === 'inline') {
      this.logger.log(
        JSON.stringify({
          event: 'worker_started_inline',
          registered_jobs: this.registry.getRegisteredJobTypes(),
        }),
        'WorkerBootstrapService',
      );
      this.running = true;
      return;
    }

    this.bullmq.ensureAllQueuesRegistered();
    for (const queueName of ALL_QUEUE_NAMES) {
      this.bullmq.registerWorker(queueName);
    }

    await this.bullmqScheduler.registerDefaultRepeatables();
    this.running = true;
    this.logger.log(
      JSON.stringify({ event: 'worker_started_bullmq', queues: ALL_QUEUE_NAMES }),
      'WorkerBootstrapService',
    );
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}
