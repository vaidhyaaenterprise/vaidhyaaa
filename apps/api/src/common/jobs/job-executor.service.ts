import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  ADAPTER_TOKENS,
  type JobExecutionContext,
  type JobHandler,
  type JobRegistry,
  validateJobPayload,
} from '@vaidya/shared';

import { AppLogger } from '../logger/logger.service';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class JobExecutorService {
  constructor(
    @Inject(ADAPTER_TOKENS.JobRegistry) private readonly registry: JobRegistry,
    @Inject(AppLogger) private readonly logger: AppLogger,
  ) {}

  async execute(
    handler: JobHandler,
    payload: Record<string, unknown>,
    context: JobExecutionContext,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  ): Promise<void> {
    let attempt = context.attempt;

    while (attempt <= maxAttempts) {
      try {
        await handler(payload, { ...context, attempt });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          JSON.stringify({
            event: 'job_failed',
            job_id: context.jobId,
            job_type: context.jobType,
            queue: context.queue,
            attempt,
            max_attempts: maxAttempts,
            correlation_id: context.correlationId,
            clinic_id: context.clinicId,
            error: message,
          }),
          undefined,
          'JobExecutorService',
        );

        if (attempt >= maxAttempts) {
          throw error;
        }

        const delayMs = DEFAULT_BACKOFF_MS * 2 ** (attempt - 1);
        await sleep(delayMs);
        attempt += 1;
      }
    }
  }

  async runValidatedJob(
    jobType: string,
    queue: string,
    payload: Record<string, unknown>,
    options: {
      jobId?: string;
      correlationId?: string;
      clinicId?: string;
      maxAttempts?: number;
    } = {},
  ): Promise<void> {
    const validatedPayload = validateJobPayload(jobType, payload);
    const handler = this.registry.getHandler(jobType);
    if (!handler) {
      throw new Error(`No handler registered for job type: ${jobType}`);
    }

    const context: JobExecutionContext = {
      jobId: options.jobId ?? randomUUID(),
      jobType,
      queue,
      attempt: 1,
      ...(options.correlationId ? { correlationId: options.correlationId } : {}),
      ...(options.clinicId
        ? { clinicId: options.clinicId }
        : validatedPayload.clinic_id
          ? { clinicId: validatedPayload.clinic_id as string }
          : {}),
    };

    await this.execute(handler, validatedPayload, context, options.maxAttempts);
  }
}
