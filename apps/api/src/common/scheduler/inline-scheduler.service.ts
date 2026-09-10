import { Inject, Injectable } from '@nestjs/common';

import { type SchedulerService } from '@vaidya/shared';

import { AppLogger } from '../logger/logger.service';

@Injectable()
export class InlineSchedulerService implements SchedulerService {
  private readonly scheduled = new Map<string, { cron: string; jobName: string }>();

  constructor(@Inject(AppLogger) private readonly logger: AppLogger) {}

  async scheduleRepeat(cron: string, jobName: string): Promise<void> {
    const key = `${cron}:${jobName}`;
    if (this.scheduled.has(key)) {
      return;
    }

    this.scheduled.set(key, { cron, jobName });
    this.logger.log(
      JSON.stringify({ event: 'inline_schedule_registered', cron, job_name: jobName }),
      'InlineSchedulerService',
    );
  }
}
