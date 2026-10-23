import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlotRuleChangeImpactService } from '../src/modules/slots/slot-rule-change-impact.service';
import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';
import { SlotService } from '../src/modules/slots/slot.service';

function dependency(target: object, name: string, value: unknown) {
  Object.defineProperty(target, name, { value });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T01:00:00Z'));
});
afterEach(() => vi.useRealTimers());

function changeHarness(occupied = false) {
  const rule = {
    id: 'rule-1',
    clinicId: 'clinic-1',
    doctorId: 'doctor-1',
    clinicServiceId: 'service-1',
    slotDurationMinutes: 15,
    capacityPerSlot: 3,
    effectiveFrom: '2026-10-01',
    effectiveTo: null,
    minBookingNoticeMinutes: 0,
    maxAdvanceBookingDays: null,
    version: 1,
    active: true,
  };
  const slots = {
    findBookingRule: vi.fn().mockResolvedValue([rule]),
    findClinicTimezone: vi.fn().mockResolvedValue([{ timezone: 'Asia/Kolkata' }]),
    listFutureOpenSlotsForRule: vi
      .fn()
      .mockResolvedValue([
        { id: 'booked-slot', startTime: '2026-10-25 09:00:00', endTime: '2026-10-25 09:15:00' },
      ]),
    countActiveAppointmentsBySlots: vi
      .fn()
      .mockResolvedValue(new Map([['booked-slot', occupied ? 1 : 0]])),
    countActiveHoldsBySlots: vi.fn().mockResolvedValue(new Map()),
  };
  const clinicalSetup = {
    listBookingRulesForDoctorService: vi.fn().mockResolvedValue([rule]),
    createBookingRule: vi.fn().mockResolvedValue([]),
    patchBookingRule: vi.fn(async (_clinic, _id, patch) => [{ ...rule, ...patch }]),
  };
  const repos = { slots, clinicalSetup };
  const save = vi.fn(async (_clinic, _scope, mutate) => mutate(repos));
  const service = Object.create(
    SlotRuleChangeImpactService.prototype,
  ) as SlotRuleChangeImpactService;
  dependency(service, 'repos', repos);
  dependency(service, 'reconciliation', { save });
  return { service, rule, slots, clinicalSetup, save };
}

describe('deferred booking rule changes', () => {
  it('saves a 15-minute snapshot before the cutoff and the new 30-minute rule with one job', async () => {
    const { service, clinicalSetup, slots, save } = changeHarness();
    const updated = await service.applyRuleUpdate('clinic-1', 'rule-1', {
      slot_duration_minutes: 30,
      capacity_per_slot: 2,
      implement_from: '2026-10-25 00:00',
    });
    expect(save).toHaveBeenCalledOnce();
    expect(clinicalSetup.createBookingRule).toHaveBeenCalledWith(
      expect.objectContaining({
        slotDurationMinutes: 15,
        capacityPerSlot: 3,
        effectiveFrom: '2026-10-01',
        effectiveTo: '2026-10-24',
        version: 2,
      }),
    );
    expect(updated).toMatchObject({
      id: 'rule-1',
      slotDurationMinutes: 30,
      capacityPerSlot: 2,
      effectiveFrom: '2026-10-25',
      version: 3,
    });
    expect(slots.listFutureOpenSlotsForRule).toHaveBeenCalledWith(
      'clinic-1',
      'rule-1',
      '2026-10-25 00:00:00',
    );
  });

  it('checks occupancy again inside the save and rejects newly booked cutoff slots', async () => {
    const { service, clinicalSetup } = changeHarness(true);
    await expect(
      service.applyRuleUpdate('clinic-1', 'rule-1', {
        slot_duration_minutes: 30,
        implement_from: '2026-10-25 00:00',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICTING_APPOINTMENTS' });
    expect(clinicalSetup.createBookingRule).not.toHaveBeenCalled();
    expect(clinicalSetup.patchBookingRule).not.toHaveBeenCalled();
  });

  it('rejects non-midnight cutoffs instead of silently changing their time', async () => {
    const { service, clinicalSetup } = changeHarness();
    await expect(
      service.applyRuleUpdate('clinic-1', 'rule-1', {
        slot_duration_minutes: 30,
        implement_from: '2026-10-25 12:00',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(clinicalSetup.patchBookingRule).not.toHaveBeenCalled();
  });
});

function generationHarness(occupied = false) {
  const current = {
    id: 'rule-new',
    slotDurationMinutes: 30,
    capacityPerSlot: 3,
    version: 3,
    effectiveFrom: '2026-10-25',
    effectiveTo: null,
  };
  const history = {
    ...current,
    id: 'rule-old',
    slotDurationMinutes: 15,
    version: 2,
    effectiveFrom: '2026-10-01',
    effectiveTo: '2026-10-24' as string | null,
  };
  const target = {
    clinicId: 'clinic-1',
    clinicTimezone: 'Asia/Kolkata',
    doctorId: 'doctor-1',
    doctorServiceId: 'mapping-1',
    clinicServiceId: 'service-1',
  };
  const oldSlot = {
    id: 'occupied-15',
    startTime: '2026-10-25 09:00:00',
    endTime: '2026-10-25 09:15:00',
    status: 'open',
  };
  const slots = {
    listActiveGenerationTargets: vi.fn().mockResolvedValue([
      { ...target, rule: current },
      { ...target, rule: history },
    ]),
    insertBatch: vi.fn().mockResolvedValue([{ id: 'batch-1' }]),
    listDoctorSchedules: vi.fn().mockResolvedValue(
      Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        startTime: '09:00:00',
        endTime: '10:00:00',
      })),
    ),
    listClinicHours: vi.fn().mockResolvedValue(
      Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        startTime: '09:00:00',
        endTime: '10:00:00',
      })),
    ),
    listClinicHolidays: vi.fn().mockResolvedValue([]),
    listDoctorBlockedSlots: vi.fn().mockResolvedValue([]),
    listExistingSlotWindows: vi.fn().mockResolvedValue(occupied ? [oldSlot] : []),
    countActiveAppointmentsBySlots: vi
      .fn()
      .mockResolvedValue(new Map(occupied ? [[oldSlot.id, 1]] : [])),
    countActiveHoldsBySlots: vi.fn().mockResolvedValue(new Map()),
    insertSlots: vi.fn(async (values) => values),
    supersedeFutureOpenSlotsByIds: vi.fn().mockResolvedValue([]),
    updateGeneratedSlotConfiguration: vi.fn().mockResolvedValue([]),
    completeBatch: vi.fn().mockResolvedValue([]),
  };
  const service = Object.create(SlotGenerationService.prototype) as SlotGenerationService;
  const repos = { slots };
  dependency(service, 'repos', repos);
  const withClinicLock = vi.fn(async (_clinic, work) => work(repos));
  dependency(service, 'withClinicLock', withClinicLock);
  return { service, slots, withClinicLock, current, history, target };
}

describe('effective slot generation', () => {
  it.each(['2026-10-27', '2026-10-28'])(
    'uses the appointment date at the exact October 28 cutover (%s)',
    async (date) => {
      const { service, slots, current, history } = generationHarness();
      current.effectiveFrom = '2026-10-28';
      current.capacityPerSlot = 2;
      history.effectiveTo = '2026-10-27';
      await service.generateSlots({ clinicId: 'clinic-1', date });
      const before = date < '2026-10-28';
      const rows = slots.insertSlots.mock.calls.flatMap((call) => call[0]);
      expect(rows).toHaveLength(before ? 4 : 2);
      expect(rows[0]).toMatchObject({
        startTime: `${date} 09:00:00`,
        endTime: `${date} ${before ? '09:15:00' : '09:30:00'}`,
        capacityTotal: before ? 3 : 2,
        generatedFromRuleId: before ? 'rule-old' : 'rule-new',
      });
    },
  );

  it('repairs unoccupied thirty-minute rows mistakenly generated before the cutover', async () => {
    const { service, slots, current, history } = generationHarness();
    current.effectiveFrom = '2026-10-28';
    current.capacityPerSlot = 2;
    history.effectiveTo = '2026-10-27';
    slots.listExistingSlotWindows.mockResolvedValue([
      {
        id: 'stale-30',
        startTime: '2026-10-27 09:00:00',
        endTime: '2026-10-27 09:30:00',
        status: 'open',
      },
    ]);
    await service.generateSlots({ clinicId: 'clinic-1', date: '2026-10-27' });
    expect(slots.insertSlots.mock.calls[0]?.[0]).toHaveLength(4);
    expect(slots.insertSlots.mock.calls[0]?.[0][0]).toMatchObject({
      endTime: '2026-10-27 09:15:00',
      capacityTotal: 3,
    });
    expect(slots.supersedeFutureOpenSlotsByIds).toHaveBeenCalledWith('clinic-1', ['stale-30']);
  });

  it.each([false, true])(
    'resolves overlapping legacy versions by date regardless of database row order (%s)',
    async (reverse) => {
      const { service, slots, current, history, target } = generationHarness();
      current.effectiveFrom = '2026-10-28';
      current.capacityPerSlot = 2;
      history.effectiveTo = null;
      const targets = [
        { ...target, rule: current },
        { ...target, rule: history },
      ];
      slots.listActiveGenerationTargets.mockResolvedValue(reverse ? targets.reverse() : targets);
      await service.generateSlots({ clinicId: 'clinic-1', horizonDays: 7 });
      const rows = slots.insertSlots.mock.calls.flatMap((call) => call[0]);
      expect(rows.filter((row) => row.startTime.startsWith('2026-10-27'))).toHaveLength(4);
      expect(rows.filter((row) => row.startTime.startsWith('2026-10-28'))).toHaveLength(2);
      expect(
        rows.every((row) =>
          row.startTime < '2026-10-28'
            ? row.generatedFromRuleId === 'rule-old'
            : row.generatedFromRuleId === 'rule-new',
        ),
      ).toBe(true);
    },
  );

  it('runs generation through the real transaction boundary and propagates failure', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const transaction = vi.fn(async (work) => work({ execute }));
    const service = new SlotGenerationService({ db: { transaction } } as never);
    const withClinicLock = Reflect.get(service, 'withClinicLock').bind(service);
    await expect(
      withClinicLock('clinic-1', async () => {
        throw new Error('generation failed');
      }),
    ).rejects.toThrow('generation failed');
    expect(transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('retries successfully without duplicating generated windows', async () => {
    const { service, slots } = generationHarness();
    type Window = { id: string; status: string; startTime: string; endTime: string };
    const saved: Window[] = [];
    slots.listExistingSlotWindows.mockImplementation(async () => saved);
    slots.insertSlots.mockImplementation(async (values) => {
      const rows = values.map((value: object, index: number) => ({
        ...value,
        id: `slot-${index}`,
        status: 'open',
      }));
      saved.push(...(rows as Window[]));
      return rows;
    });
    const input = { clinicId: 'clinic-1', date: '2026-10-25' };
    expect(await service.generateSlots(input)).toEqual([expect.objectContaining({ inserted: 2 })]);
    expect(await service.generateSlots(input)).toEqual([expect.objectContaining({ inserted: 0 })]);
    expect(saved).toHaveLength(2);
  });

  it('generates old and new durations only inside their respective date ranges', async () => {
    const { service, slots, withClinicLock } = generationHarness();
    await service.generateSlots({ clinicId: 'clinic-1', horizonDays: 3 });
    expect(withClinicLock).toHaveBeenCalledOnce();
    const values = slots.insertSlots.mock.calls.flatMap((call) => call[0]) as Array<{
      startTime: string;
      endTime: string;
      generatedFromRuleId: string;
    }>;
    expect(values.filter((slot) => slot.startTime.startsWith('2026-10-23'))).toHaveLength(4);
    expect(values.filter((slot) => slot.startTime.startsWith('2026-10-25'))).toHaveLength(2);
    expect(
      values.every((slot) =>
        slot.startTime < '2026-10-25'
          ? slot.generatedFromRuleId === 'rule-old'
          : slot.generatedFromRuleId === 'rule-new',
      ),
    ).toBe(true);
    expect(slots.listExistingSlotWindows).toHaveBeenCalledWith(
      'clinic-1',
      'doctor-1',
      'service-1',
      '2026-10-25 00:00:00',
      '2026-10-26 23:59:59',
    );
    expect(slots.listExistingSlotWindows).toHaveBeenCalledWith(
      'clinic-1',
      'doctor-1',
      'service-1',
      '2026-10-23 00:00:00',
      '2026-10-24 23:59:59',
    );
  });

  it('does not supersede occupied slots or generate a new duration over an existing booking', async () => {
    const { service, slots } = generationHarness(true);
    await service.generateSlots({ clinicId: 'clinic-1', date: '2026-10-25' });
    expect(slots.supersedeFutureOpenSlotsByIds).toHaveBeenCalledWith('clinic-1', []);
    expect(slots.insertSlots).toHaveBeenCalledWith([
      expect.objectContaining({ startTime: '2026-10-25 09:30:00' }),
    ]);
  });

  it('does not retire existing slots if inserting replacements fails', async () => {
    const { service, slots } = generationHarness();
    slots.insertSlots.mockRejectedValueOnce(new Error('insert failed'));
    await expect(
      service.generateSlots({ clinicId: 'clinic-1', date: '2026-10-25' }),
    ).rejects.toThrow('insert failed');
    expect(slots.supersedeFutureOpenSlotsByIds).not.toHaveBeenCalled();
    expect(slots.completeBatch).not.toHaveBeenCalled();
  });
});

describe('availability during background updates', () => {
  it('reports missing earlier rules rather than using a future rule as a default', async () => {
    const service = Object.create(SlotService.prototype) as SlotService;
    dependency(service, 'repos', {
      slots: {
        listAvailableOpenSlots: vi.fn().mockResolvedValue([]),
        findEffectiveBookingRuleForDate: vi.fn().mockResolvedValue([]),
      },
    });
    dependency(service, 'reconciliation', {
      status: vi.fn().mockResolvedValue({ state: 'ready' }),
    });
    await expect(
      service.listProposableSlots('clinic-1', 'doctor-1', 'service-1', '2026-10-27'),
    ).rejects.toMatchObject({
      code: 'CLINIC_SETUP_INCOMPLETE',
      message: expect.stringContaining('earlier configuration must be restored'),
    });
  });
  it.each(['failed', 'updating'] as const)(
    'reports %s updates instead of a misleading empty slot list',
    async (state) => {
      const service = Object.create(SlotService.prototype) as SlotService;
      dependency(service, 'repos', {
        slots: { listAvailableOpenSlots: vi.fn().mockResolvedValue([]) },
      });
      dependency(service, 'reconciliation', { status: vi.fn().mockResolvedValue({ state }) });
      await expect(
        service.listProposableSlots('clinic-1', 'doctor-1', 'service-1'),
      ).rejects.toMatchObject({
        code: state === 'failed' ? 'SLOT_UPDATE_FAILED' : 'SLOT_UPDATE_PENDING',
      });
    },
  );
});
