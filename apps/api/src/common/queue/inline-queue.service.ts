import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  type EnqueueJobInput,
  type QueueService,
  validateJobPayload,
} from '@vaidya/shared';

import { AppLogger } from '../logger/logger.service';

import { JobExecutorService } from '../jobs/job-executor.service';

@Injectable()
export class InlineQueueService implements QueueService {
  constructor(
    @Inject(JobExecutorService) private readonly executor: JobExecutorService,
    @Inject(AppLogger) private readonly logger: AppLogger,
  ) {}

  async enqueue(job: EnqueueJobInput): Promise<string> {
    const jobId = job.jobId ?? randomUUID();
    validateJobPayload(job.jobType, job.payload);

    this.logger.log(
      JSON.stringify({
        event: 'job_enqueued_inline',
        job_id: jobId,
        job_type: job.jobType,
        queue: job.queue,
        correlation_id: job.correlationId,
        clinic_id: job.clinicId,
      }),
      'InlineQueueService',
    );

    setImmediate(() => {
      void this.executor
        .runValidatedJob(job.jobType, job.queue, job.payload, {
          jobId,
          ...(job.correlationId ? { correlationId: job.correlationId } : {}),
          ...(job.clinicId ? { clinicId: job.clinicId } : {}),
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(
            JSON.stringify({
              event: 'inline_job_terminal_failure',
              job_id: jobId,
              job_type: job.jobType,
              queue: job.queue,
              error: message,
            }),
            undefined,
            'InlineQueueService',
          );
        });
    });

    return jobId;
  }

  async enqueueBulk(jobs: EnqueueJobInput[]): Promise<string[]> {
    if (jobs.length === 0) {
      return [];
    }

    const preparedJobs = jobs.map((job) => {
      validateJobPayload(job.jobType, job.payload);
      return {
        job,
        jobId: job.jobId ?? randomUUID(),
      };
    });

    this.logger.log(
      JSON.stringify({
        event: 'jobs_enqueued_bulk_inline',
        job_count: preparedJobs.length,
        queues: [...new Set(preparedJobs.map(({ job }) => job.queue))],
      }),
      'InlineQueueService',
    );

    setImmediate(() => {
      for (const { job, jobId } of preparedJobs) {
        void this.executor
          .runValidatedJob(job.jobType, job.queue, job.payload, {
            jobId,
            ...(job.correlationId ? { correlationId: job.correlationId } : {}),
            ...(job.clinicId ? { clinicId: job.clinicId } : {}),
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(
              JSON.stringify({
                event: 'inline_job_terminal_failure',
                job_id: jobId,
                job_type: job.jobType,
                queue: job.queue,
                error: message,
              }),
              undefined,
              'InlineQueueService',
            );
          });
      }
    });

    return preparedJobs.map(({ jobId }) => jobId);
  }
}
