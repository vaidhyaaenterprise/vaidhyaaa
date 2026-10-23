import { describe, expect, it, vi } from 'vitest';
import { SlotReconciliationService } from '../src/modules/slots/slot-reconciliation.service';
import { SlotReconciliationController } from '../src/modules/slots/slot-reconciliation.controller';
import { ClinicClinicalService } from '../src/modules/clinic-setup/clinic-clinical.service';

function dependency(target: object, name: string, value: unknown) {
  Object.defineProperty(target, name, { value });
}

function jobsHarness() {
  const service = Object.create(SlotReconciliationService.prototype) as SlotReconciliationService;
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockReturnValue({ where });
  const values = vi.fn().mockResolvedValue([]);
  const tx = {
    execute: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnValue({ values }),
  };
  const transaction = vi.fn(async (mutate: (transaction: typeof tx) => Promise<unknown>) =>
    mutate(tx),
  );
  dependency(service, 'connection', {
    db: { transaction, update: vi.fn().mockReturnValue({ set }) },
  });
  const generateSlots = vi.fn().mockResolvedValue([]);
  dependency(service, 'generation', { generateSlots });
  dependency(service, 'logger', { error: vi.fn() });
  return { service, values, set, where, generateSlots };
}

describe('durable slot reconciliation', () => {
  it('reports a failed job explicitly, even when no work remains pending', async () => {
    const jobs = {
      drain: vi.fn().mockResolvedValue(1),
      status: vi.fn().mockResolvedValue({ state: 'failed', failed: 1, remaining: 0 }),
    };
    const controller = new SlotReconciliationController(jobs as never);
    await expect(controller.runClinic('clinic-1')).resolves.toEqual({
      processed: 1,
      state: 'failed',
      failed: 1,
      remaining: 0,
    });
  });

  it('requeues failed work only for the requested clinic and enqueues a repair', async () => {
    const jobs = {
      retryFailed: vi.fn().mockResolvedValue(undefined),
      enqueue: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue({ state: 'updating', remaining: 1, failed: 0 }),
    };
    await new SlotReconciliationController(jobs as never).retry('clinic-1');
    expect(jobs.retryFailed).toHaveBeenCalledWith('clinic-1');
    expect(jobs.enqueue).toHaveBeenCalledWith('clinic-1');
  });

  it('saves settings and a persistent job in the same transaction without awaiting slot generation', async () => {
    const { service, values, generateSlots } = jobsHarness();
    const mutate = vi.fn().mockResolvedValue('saved');
    expect(await service.save('clinic-1', { doctorId: 'doctor-1' }, mutate)).toBe('saved');
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: 'clinic-1',
        jobType: 'RECONCILE_SLOTS',
        payloadJson: { doctorId: 'doctor-1' },
      }),
    );
    expect(generateSlots).not.toHaveBeenCalled();
  });

  it('does not enqueue when saving settings fails and propagates outbox persistence failures', async () => {
    const { service, values } = jobsHarness();
    await expect(
      service.save('clinic-1', {}, async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    expect(values).not.toHaveBeenCalled();
    values.mockRejectedValueOnce(new Error('outbox failed'));
    await expect(service.save('clinic-1', {}, async () => 'saved')).rejects.toThrow(
      'outbox failed',
    );
  });

  it('processes current configuration and marks the claimed job completed', async () => {
    const { service, generateSlots, set } = jobsHarness();
    dependency(
      service,
      'claim',
      vi
        .fn()
        .mockResolvedValueOnce({
          id: 'job-1',
          clinicId: 'clinic-1',
          payloadJson: { doctorId: 'doctor-1' },
          attemptCount: 1,
          maxAttempts: 5,
        })
        .mockResolvedValue(undefined),
    );
    expect(await service.drain('clinic-1')).toBe(1);
    expect(generateSlots).toHaveBeenCalledWith({ clinicId: 'clinic-1', doctorId: 'doctor-1' });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', lastError: null }),
    );
  });

  it('retains failed work for backoff retry and dead-letters exhausted attempts', async () => {
    for (const attemptCount of [1, 5]) {
      const { service, generateSlots, set } = jobsHarness();
      dependency(
        service,
        'claim',
        vi
          .fn()
          .mockResolvedValueOnce({
            id: 'job-1',
            clinicId: 'clinic-1',
            payloadJson: {},
            attemptCount,
            maxAttempts: 5,
          })
          .mockResolvedValue(undefined),
      );
      generateSlots.mockRejectedValue(new Error('database unavailable'));
      await service.drain('clinic-1');
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: attemptCount === 5 ? 'failed' : 'pending',
          lastError: 'database unavailable',
          lockedBy: null,
          scheduledAt: expect.any(Date),
        }),
      );
    }
  });

  it('rejects unauthenticated recovery requests including an unset scheduler secret', async () => {
    const controller = new SlotReconciliationController({ drain: vi.fn() } as never);
    const previous = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      await expect(controller.recover()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      process.env.CRON_SECRET = 'test-secret';
      await expect(controller.recover('Bearer wrong-secret')).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previous;
    }
  });
});

describe('shared doctor schedules', () => {
  function harness(blocked: boolean) {
    const service = Object.create(ClinicClinicalService.prototype) as ClinicClinicalService;
    const replaceDoctorSchedules = vi.fn().mockResolvedValue([]);
    const repos = {
      clinicalSetup: {
        listActiveDoctors: vi.fn().mockResolvedValue([{ id: 'doctor-1' }, { id: 'doctor-2' }]),
        replaceDoctorSchedules,
      },
    };
    dependency(service, 'repos', repos);
    const preview = vi
      .fn()
      .mockResolvedValueOnce({ blocked: false, conflicts: [] })
      .mockResolvedValue({
        blocked,
        conflicts: blocked ? [{ reason: 'outside_doctor_hours' }] : [],
      });
    dependency(service, 'scheduleChangeImpact', { previewDoctorSchedulesReplace: preview });
    const save = vi.fn(
      async (_clinicId: string, _scope: unknown, mutate: (repos: unknown) => Promise<unknown>) =>
        mutate(repos),
    );
    dependency(service, 'slotReconciliation', { save });
    return { service, preview, save, replaceDoctorSchedules };
  }
  const input = {
    windows: [{ day_of_week: 1, start_time: '09:00', end_time: '13:00', active: true }],
  };
  it('validates and replaces every active doctor in one durable save', async () => {
    const { service, preview, save, replaceDoctorSchedules } = harness(false);
    await service.replaceAllDoctorSchedules('clinic-1', input);
    expect(preview).toHaveBeenCalledTimes(4);
    expect(save).toHaveBeenCalledOnce();
    expect(replaceDoctorSchedules.mock.calls.map((args) => args[1])).toEqual([
      'doctor-1',
      'doctor-2',
    ]);
  });
  it('does not change any doctor if one has an appointment conflict', async () => {
    const { service, save, replaceDoctorSchedules } = harness(true);
    await expect(service.replaceAllDoctorSchedules('clinic-1', input)).rejects.toMatchObject({
      code: 'CONFLICTING_APPOINTMENTS',
    });
    expect(save).not.toHaveBeenCalled();
    expect(replaceDoctorSchedules).not.toHaveBeenCalled();
  });
  it('rejects overlaps before checking appointments or saving', async () => {
    const { service, preview, save } = harness(false);
    await expect(
      service.replaceDoctorSchedules('clinic-1', 'doctor-1', {
        windows: [...input.windows, ...input.windows],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(preview).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
