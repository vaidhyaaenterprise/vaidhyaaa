import { Inject, Injectable } from '@nestjs/common';
import { type ApiEnv } from '@vaidya/config';

import { ALL_QUEUE_NAMES, JOB_QUEUE_MAP, JOB_TYPES, type SchedulerService } from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';
import { AppLogger } from '../logger/logger.service';
import { BullMQQueueService } from '../queue/bullmq-queue.service';

const REPEATABLE_JOBS: Array<{ cron: string; jobType: string }> = [
  { cron: '*/1 * * * *', jobType: JOB_TYPES.EXPIRE_SLOT_HOLDS },
  { cron: '5 0 * * *', jobType: JOB_TYPES.GENERATE_SLOTS },
  { cron: '0 2 * * *', jobType: JOB_TYPES.CLEANUP_EXPIRED_RECORDINGS },
  { cron: '0 3 * * *', jobType: JOB_TYPES.CLEANUP_EXPIRED_TRANSCRIPTS },
  { cron: '0 4 * * *', jobType: JOB_TYPES.GENERATE_DAILY_CLINIC_REPORT },
];

@Injectable()
export class BullMQSchedulerService implements SchedulerService {
  private readonly registered = new Set<string>();

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly bullmq: BullMQQueueService,
    private readonly logger: AppLogger,
  ) {}

  async scheduleRepeat(cron: string, jobName: string): Promise<void> {
    assertRedisUrlForBullmq(this.env.REDIS_URL);
    const key = `${cron}:${jobName}`;
    if (this.registered.has(key)) {
      return;
    }

    const queueName = JOB_QUEUE_MAP[jobName as keyof typeof JOB_QUEUE_MAP];
    if (!queueName) {
      throw new Error(`Unknown repeatable job: ${jobName}`);
    }

    const queue = this.bullmq.getQueue(queueName);
    await queue.add(
      jobName,
      { payload: {} },
      {
        jobId: `repeat:${jobName}`,
        repeat: { pattern: cron },
      },
    );

    this.registered.add(key);
    this.logger.log(
      JSON.stringify({ event: 'bullmq_schedule_registered', cron, job_name: jobName, queue: queueName }),
      'BullMQSchedulerService',
    );
  }

  async registerDefaultRepeatables(): Promise<void> {
    for (const job of REPEATABLE_JOBS) {
      await this.scheduleRepeat(job.cron, job.jobType);
    }
  }
}

function assertRedisUrlForBullmq(redisUrl: string | undefined): string {
  if (!redisUrl) {
    throw new Error('REDIS_URL is required when QUEUE_MODE is bullmq');
  }
  return redisUrl;
}

export function getDefaultRepeatableQueues(): readonly string[] {
  return ALL_QUEUE_NAMES;
}
