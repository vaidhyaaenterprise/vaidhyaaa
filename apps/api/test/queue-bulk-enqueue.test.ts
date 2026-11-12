import { setImmediate as waitForImmediate } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import { JOB_TYPES, QUEUE_NAMES, type EnqueueJobInput } from '@vaidya/shared';

import { BullMQQueueService } from '../src/common/queue/bullmq-queue.service';
import { InlineQueueService } from '../src/common/queue/inline-queue.service';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';

function notificationJob(notificationEventId: string): EnqueueJobInput {
  return {
    queue: QUEUE_NAMES.NOTIFICATIONS,
    jobType: JOB_TYPES.SEND_NOTIFICATION,
    clinicId: CLINIC_ID,
    payload: {
      clinic_id: CLINIC_ID,
      notification_event_id: notificationEventId,
      channel: 'dashboard',
      recipient: 'staff',
      template_key: 'booking.created_pending',
    },
  };
}

const JOBS = [
  notificationJob('00000000-0000-0000-0000-000000000501'),
  notificationJob('00000000-0000-0000-0000-000000000502'),
];

const logger = {
  log: vi.fn(),
  error: vi.fn(),
};

describe('queue bulk enqueue', () => {
  it('uses one BullMQ addBulk call for jobs on the same queue', async () => {
    const addBulk = vi.fn().mockResolvedValue([]);
    const service = Object.create(BullMQQueueService.prototype) as BullMQQueueService;
    Reflect.set(service, 'logger', logger);
    vi.spyOn(service, 'getQueue').mockReturnValue({ addBulk } as never);

    const jobIds = await service.enqueueBulk(JOBS);

    expect(jobIds).toHaveLength(2);
    expect(addBulk).toHaveBeenCalledTimes(1);
    const queuedJobs = addBulk.mock.calls[0]?.[0];
    expect(queuedJobs).toHaveLength(2);
    expect(queuedJobs?.map((job: { opts: { jobId: string } }) => job.opts.jobId)).toEqual(jobIds);
  });

  it('schedules an inline batch once and executes every validated job', async () => {
    const runValidatedJob = vi.fn().mockResolvedValue(undefined);
    const service = new InlineQueueService(
      { runValidatedJob } as never,
      logger as never,
    );

    const jobIds = await service.enqueueBulk(JOBS);
    expect(jobIds).toHaveLength(2);
    expect(runValidatedJob).not.toHaveBeenCalled();

    await waitForImmediate();
    expect(runValidatedJob).toHaveBeenCalledTimes(2);
  });

  it('validates the entire inline batch before scheduling any jobs', async () => {
    const runValidatedJob = vi.fn().mockResolvedValue(undefined);
    const service = new InlineQueueService(
      { runValidatedJob } as never,
      logger as never,
    );

    await expect(
      service.enqueueBulk([
        JOBS[0]!,
        {
          queue: QUEUE_NAMES.NOTIFICATIONS,
          jobType: JOB_TYPES.SEND_NOTIFICATION,
          payload: { clinic_id: CLINIC_ID },
        },
      ]),
    ).rejects.toThrow();

    await waitForImmediate();
    expect(runValidatedJob).not.toHaveBeenCalled();
  });
});
