import { Global, Module } from '@nestjs/common';

import { ADAPTER_TOKENS } from '@vaidya/shared';
import { type ApiEnv } from '@vaidya/config';

import { API_ENV } from '../../config/api-config.module';
import { LoggerModule } from '../logger/logger.module';
import { InMemoryLockService } from '../locks/in-memory-lock.service';
import { RedisLockService } from '../locks/redis-lock.service';
import { InlineQueueService } from '../queue/inline-queue.service';
import { BullMQQueueService } from '../queue/bullmq-queue.service';
import { InlineSchedulerService } from '../scheduler/inline-scheduler.service';
import { BullMQSchedulerService } from '../scheduler/bullmq-scheduler.service';
import { InMemoryRateLimitService } from '../rate-limit/in-memory-rate-limit.service';
import { RedisRateLimitService } from '../rate-limit/redis-rate-limit.service';

import { JobExecutorService } from './job-executor.service';
import { JobRegistryService } from './job-registry.service';
import { DefaultJobHandlersRegistrar, WorkerBootstrapService } from './worker-bootstrap.service';

@Global()
@Module({
  imports: [LoggerModule],
  providers: [
    JobRegistryService,
    {
      provide: ADAPTER_TOKENS.JobRegistry,
      useExisting: JobRegistryService,
    },
    JobExecutorService,
    InlineQueueService,
    BullMQQueueService,
    InlineSchedulerService,
    BullMQSchedulerService,
    InMemoryLockService,
    RedisLockService,
    InMemoryRateLimitService,
    RedisRateLimitService,
    DefaultJobHandlersRegistrar,
    WorkerBootstrapService,
    {
      provide: ADAPTER_TOKENS.WorkerBootstrap,
      useExisting: WorkerBootstrapService,
    },
    {
      provide: ADAPTER_TOKENS.QueueService,
      useFactory: (env: ApiEnv, inline: InlineQueueService, bullmq: BullMQQueueService) =>
        env.QUEUE_MODE === 'bullmq' ? bullmq : inline,
      inject: [API_ENV, InlineQueueService, BullMQQueueService],
    },
    {
      provide: ADAPTER_TOKENS.LockService,
      useFactory: (env: ApiEnv, inMemory: InMemoryLockService, redis: RedisLockService) =>
        env.QUEUE_MODE === 'bullmq' ? redis : inMemory,
      inject: [API_ENV, InMemoryLockService, RedisLockService],
    },
    {
      provide: ADAPTER_TOKENS.SchedulerService,
      useFactory: (
        env: ApiEnv,
        inline: InlineSchedulerService,
        bullmq: BullMQSchedulerService,
      ) => (env.QUEUE_MODE === 'bullmq' ? bullmq : inline),
      inject: [API_ENV, InlineSchedulerService, BullMQSchedulerService],
    },
    {
      provide: ADAPTER_TOKENS.RateLimitService,
      useFactory: (
        env: ApiEnv,
        inMemory: InMemoryRateLimitService,
        redis: RedisRateLimitService,
      ) => (env.QUEUE_MODE === 'bullmq' ? redis : inMemory),
      inject: [API_ENV, InMemoryRateLimitService, RedisRateLimitService],
    },
  ],
  exports: [
    ADAPTER_TOKENS.QueueService,
    ADAPTER_TOKENS.LockService,
    ADAPTER_TOKENS.SchedulerService,
    ADAPTER_TOKENS.RateLimitService,
    ADAPTER_TOKENS.JobRegistry,
    ADAPTER_TOKENS.WorkerBootstrap,
    BullMQQueueService,
  ],
})
export class JobInfrastructureModule {}
