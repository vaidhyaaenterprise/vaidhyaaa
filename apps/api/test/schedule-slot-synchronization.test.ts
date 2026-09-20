import { describe, expect, it, vi } from 'vitest';

import { ClinicClinicalService } from '../src/modules/clinic-setup/clinic-clinical.service';
import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';
import { SlotHoldService } from '../src/modules/slots/slot-hold.service';

function installPrivateDependency(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value });
}

describe('schedule slot synchronization', () => {
  it('honors doctor effective dates, creates new windows, and retires stale open windows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T03:00:00.000Z'));

    const existingSlots = [
      {
        id: 'stale-slot',
        startTime: '2026-09-20 09:00:00',
        endTime: '2026-09-20 09:30:00',
        status: 'open',
      },
      {
        id: 'existing-effective-slot',
        startTime: '2026-09-27 09:00:00',
        endTime: '2026-09-27 09:30:00',
        status: 'open',
      },
    ];
    const slots = {
      listActiveGenerationTargets: vi.fn().mockResolvedValue([
        {
          clinicId: 'clinic-1',
          clinicTimezone: 'Asia/Kolkata',
          doctorId: 'doctor-1',
          doctorServiceId: 'doctor-service-1',
          clinicServiceId: 'service-1',
          rule: {
            id: 'rule-1',
            slotDurationMinutes: 30,
            capacityPerSlot: 1,
            bookingHorizonDays: 7,
            version: 1,
          },
        },
      ]),
      insertBatch: vi.fn().mockResolvedValue([{ id: 'batch-1' }]),
      listDoctorSchedules: vi.fn().mockResolvedValue([
        {
          dayOfWeek: 0,
          startTime: '09:00:00',
          endTime: '10:00:00',
          effectiveFrom: '2026-09-27',
          effectiveTo: '2026-09-27',
        },
      ]),
      listClinicHours: vi
        .fn()
        .mockResolvedValue([{ dayOfWeek: 0, startTime: '09:00:00', endTime: '10:00:00' }]),
      listClinicHolidays: vi.fn().mockResolvedValue([]),
      listDoctorBlockedSlots: vi.fn().mockResolvedValue([]),
      listExistingSlotWindows: vi.fn().mockResolvedValue(existingSlots),
      insertSlots: vi.fn(async (values: unknown[]) => values),
      supersedeFutureOpenSlotsByIds: vi.fn().mockResolvedValue([{ id: 'stale-slot' }]),
      completeBatch: vi.fn().mockResolvedValue([]),
    };
    const service = Object.create(SlotGenerationService.prototype) as SlotGenerationService;
    installPrivateDependency(service, 'repos', { slots });

    try {
      const result = await service.generateSlots({
        clinicId: 'clinic-1',
        doctorId: 'doctor-1',
        clinicServiceId: 'service-1',
        horizonDays: 7,
      });

      expect(slots.insertSlots).toHaveBeenCalledOnce();
      expect(slots.insertSlots.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({
          startTime: '2026-09-27 09:30:00',
          endTime: '2026-09-27 10:00:00',
        }),
      ]);
      expect(slots.supersedeFutureOpenSlotsByIds).toHaveBeenCalledWith('clinic-1', ['stale-slot']);
      expect(result).toEqual([
        expect.objectContaining({ inserted: 1, superseded: 1, horizon_days: 7 }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retires open slots when the clinic no longer works on that day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T03:00:00.000Z'));

    const slots = {
      listActiveGenerationTargets: vi.fn().mockResolvedValue([
        {
          clinicId: 'clinic-1',
          clinicTimezone: 'Asia/Kolkata',
          doctorId: 'doctor-1',
          doctorServiceId: 'doctor-service-1',
          clinicServiceId: 'service-1',
          rule: {
            id: 'rule-1',
            slotDurationMinutes: 30,
            capacityPerSlot: 1,
            bookingHorizonDays: 0,
            version: 1,
          },
        },
      ]),
      insertBatch: vi.fn().mockResolvedValue([{ id: 'batch-1' }]),
      listDoctorSchedules: vi.fn().mockResolvedValue([
        {
          dayOfWeek: 0,
          startTime: '09:00:00',
          endTime: '10:00:00',
          effectiveFrom: null,
          effectiveTo: null,
        },
      ]),
      listClinicHours: vi.fn().mockResolvedValue([]),
      listClinicHolidays: vi.fn().mockResolvedValue([]),
      listDoctorBlockedSlots: vi.fn().mockResolvedValue([]),
      listExistingSlotWindows: vi.fn().mockResolvedValue([
        {
          id: 'closed-day-slot',
          startTime: '2026-09-20 09:00:00',
          endTime: '2026-09-20 09:30:00',
          status: 'open',
        },
      ]),
      insertSlots: vi.fn().mockResolvedValue([]),
      supersedeFutureOpenSlotsByIds: vi.fn().mockResolvedValue([{ id: 'closed-day-slot' }]),
      completeBatch: vi.fn().mockResolvedValue([]),
    };
    const service = Object.create(SlotGenerationService.prototype) as SlotGenerationService;
    installPrivateDependency(service, 'repos', { slots });

    try {
      const result = await service.generateSlots({
        clinicId: 'clinic-1',
        doctorId: 'doctor-1',
        clinicServiceId: 'service-1',
        horizonDays: 0,
      });

      expect(slots.insertSlots).toHaveBeenCalledWith([]);
      expect(slots.supersedeFutureOpenSlotsByIds).toHaveBeenCalledWith('clinic-1', [
        'closed-day-slot',
      ]);
      expect(result).toEqual([
        expect.objectContaining({ inserted: 0, superseded: 1, horizon_days: 0 }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('limits on-demand repair to the requested date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T03:00:00.000Z'));

    const slots = {
      listActiveGenerationTargets: vi.fn().mockResolvedValue([
        {
          clinicId: 'clinic-1',
          clinicTimezone: 'Asia/Kolkata',
          doctorId: 'doctor-1',
          doctorServiceId: 'doctor-service-1',
          clinicServiceId: 'service-1',
          rule: {
            id: 'rule-1',
            slotDurationMinutes: 30,
            capacityPerSlot: 1,
            bookingHorizonDays: 7,
            version: 1,
          },
        },
      ]),
      insertBatch: vi.fn().mockResolvedValue([{ id: 'batch-1' }]),
      listDoctorSchedules: vi.fn().mockResolvedValue([
        {
          dayOfWeek: 0,
          startTime: '09:00:00',
          endTime: '10:00:00',
          effectiveFrom: null,
          effectiveTo: null,
        },
      ]),
      listClinicHours: vi
        .fn()
        .mockResolvedValue([{ dayOfWeek: 0, startTime: '09:00:00', endTime: '10:00:00' }]),
      listClinicHolidays: vi.fn().mockResolvedValue([]),
      listDoctorBlockedSlots: vi.fn().mockResolvedValue([]),
      listExistingSlotWindows: vi.fn().mockResolvedValue([]),
      insertSlots: vi.fn(async (values: unknown[]) => values),
      supersedeFutureOpenSlotsByIds: vi.fn().mockResolvedValue([]),
      completeBatch: vi.fn().mockResolvedValue([]),
    };
    const service = Object.create(SlotGenerationService.prototype) as SlotGenerationService;
    installPrivateDependency(service, 'repos', { slots });

    try {
      await service.generateSlots({
        clinicId: 'clinic-1',
        doctorId: 'doctor-1',
        clinicServiceId: 'service-1',
        date: '2026-09-20',
      });

      expect(slots.listClinicHolidays).toHaveBeenCalledWith(
        'clinic-1',
        '2026-09-20',
        '2026-09-20',
        'doctor-1',
      );
      expect(slots.listExistingSlotWindows).toHaveBeenCalledWith(
        'clinic-1',
        'doctor-1',
        'service-1',
        '2026-09-20 00:00:00',
        '2026-09-20 23:59:59',
      );
      expect(slots.insertSlots).toHaveBeenCalledWith([
        expect.objectContaining({ startTime: '2026-09-20 09:00:00' }),
        expect.objectContaining({ startTime: '2026-09-20 09:30:00' }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('regenerates every active doctor-service target after clinic hours are replaced', async () => {
    const replaceClinicHours = vi.fn().mockResolvedValue([]);
    const generateSlots = vi.fn().mockResolvedValue([]);
    const service = Object.create(ClinicClinicalService.prototype) as ClinicClinicalService;
    installPrivateDependency(service, 'repos', { clinicalSetup: { replaceClinicHours } });
    installPrivateDependency(service, 'scheduleChangeImpact', {
      previewClinicHoursReplace: vi.fn().mockResolvedValue({ blocked: false, conflicts: [] }),
    });
    installPrivateDependency(service, 'slotGeneration', { generateSlots });

    await service.replaceClinicHours('clinic-1', {
      windows: [{ day_of_week: 0, start_time: '09:00', end_time: '13:00', active: true }],
    });

    expect(replaceClinicHours).toHaveBeenCalledOnce();
    expect(generateSlots).toHaveBeenCalledWith({ clinicId: 'clinic-1' });
  });

  it('does not hide a synchronization failure after doctor schedules are replaced', async () => {
    const replaceDoctorSchedules = vi.fn().mockResolvedValue([]);
    const synchronizationFailure = new Error('slot synchronization failed');
    const service = Object.create(ClinicClinicalService.prototype) as ClinicClinicalService;
    installPrivateDependency(service, 'repos', { clinicalSetup: { replaceDoctorSchedules } });
    installPrivateDependency(service, 'scheduleChangeImpact', {
      previewDoctorSchedulesReplace: vi.fn().mockResolvedValue({ blocked: false, conflicts: [] }),
    });
    installPrivateDependency(service, 'slotGeneration', {
      generateSlots: vi.fn().mockRejectedValue(synchronizationFailure),
    });

    await expect(
      service.replaceDoctorSchedules('clinic-1', 'doctor-1', {
        windows: [{ day_of_week: 0, start_time: '09:00', end_time: '13:00', active: true }],
      }),
    ).rejects.toBe(synchronizationFailure);
  });

  it('does not convert a hold after its slot was retired by a schedule change', async () => {
    const service = Object.create(SlotHoldService.prototype) as SlotHoldService;
    installPrivateDependency(service, 'dbService', {
      withSlotForUpdate: vi.fn(
        async (
          _clinicId: string,
          _slotId: string,
          callback: (slot: { status: string }, tx: unknown) => Promise<unknown>,
        ) => callback({ status: 'superseded' }, {}),
      ),
    });

    await expect(
      service.createAppointmentFromHold({
        clinicId: 'clinic-1',
        slotId: 'retired-slot',
        holdId: 'hold-1',
        patientName: 'Patient',
        reasonForVisit: 'Checkup',
      }),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
  });
});
