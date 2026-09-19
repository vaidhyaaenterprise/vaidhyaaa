import { describe, expect, it, vi } from 'vitest';

import { AppointmentsService } from '../src/modules/appointment/appointments.service';
import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';
import { SlotRuleChangeImpactService } from '../src/modules/slots/slot-rule-change-impact.service';

function installPrivateDependency(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value });
}

describe('query optimization regressions', () => {
  it('loads action-request appointments in one clinic-scoped bulk query', async () => {
    const appointmentLifecycle = {
      listPendingActionRequests: vi.fn().mockResolvedValue([
        {
          id: 'action-1',
          appointmentId: 'appointment-1',
          requestedNewDate: null,
          requestedNewTimePreference: null,
          requestedNewSlotId: null,
          reason: 'Cannot attend',
          requestType: 'cancel',
          status: 'pending',
        },
        {
          id: 'action-2',
          appointmentId: 'appointment-1',
          requestedNewDate: '2026-09-18',
          requestedNewTimePreference: 'morning',
          requestedNewSlotId: 'slot-2',
          reason: null,
          requestType: 'reschedule',
          status: 'pending',
        },
      ]),
      findAppointmentsByIds: vi.fn().mockResolvedValue([
        {
          id: 'appointment-1',
          patientName: 'Patient One',
          doctorId: 'doctor-1',
          clinicServiceId: 'service-1',
        },
      ]),
    };
    const repos = {
      appointmentLifecycle,
      clinical: {
        listDoctors: vi.fn().mockResolvedValue([{ id: 'doctor-1', name: 'Dr One' }]),
        listServices: vi
          .fn()
          .mockResolvedValue([{ id: 'service-1', serviceName: 'General consultation' }]),
      },
    };
    const service = Object.create(AppointmentsService.prototype) as AppointmentsService;
    installPrivateDependency(service, 'repos', repos);

    const result = await service.listActionRequests('clinic-1');

    expect(appointmentLifecycle.findAppointmentsByIds).toHaveBeenCalledTimes(1);
    expect(appointmentLifecycle.findAppointmentsByIds).toHaveBeenCalledWith('clinic-1', [
      'appointment-1',
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        id: 'action-1',
        appointment_id: 'appointment-1',
        patient_name: 'Patient One',
        doctor_name: 'Dr One',
        service_name: 'General consultation',
        action_type: 'cancel',
      }),
      expect.objectContaining({
        id: 'action-2',
        appointment_id: 'appointment-1',
        patient_name: 'Patient One',
        doctor_name: 'Dr One',
        service_name: 'General consultation',
        action_type: 'reschedule',
      }),
    ]);
  });

  it('checks all future slot occupancy with two bulk queries', async () => {
    const slots = {
      findBookingRule: vi.fn().mockResolvedValue([
        {
          version: 3,
          doctorId: 'doctor-1',
          clinicServiceId: 'service-1',
        },
      ]),
      listFutureOpenSlotsForRule: vi.fn().mockResolvedValue([
        {
          id: 'slot-1',
          startTime: '2026-09-18 09:00:00',
          endTime: '2026-09-18 09:30:00',
        },
        {
          id: 'slot-2',
          startTime: '2026-09-18 09:30:00',
          endTime: '2026-09-18 10:00:00',
        },
      ]),
      countActiveAppointmentsBySlots: vi
        .fn()
        .mockResolvedValue(new Map<string, number>([['slot-1', 0]])),
      countActiveHoldsBySlots: vi.fn().mockResolvedValue(new Map<string, number>([['slot-2', 0]])),
      supersedeFutureOpenSlots: vi.fn().mockResolvedValue([{ id: 'slot-1' }, { id: 'slot-2' }]),
      updateBookingRule: vi.fn().mockResolvedValue([]),
    };
    const slotGenerationService = {
      generateSlots: vi.fn().mockResolvedValue({ created: 2 }),
    };
    const service = Object.create(
      SlotRuleChangeImpactService.prototype,
    ) as SlotRuleChangeImpactService;
    installPrivateDependency(service, 'repos', { slots });
    installPrivateDependency(service, 'slotGenerationService', slotGenerationService);

    const result = await service.applyDurationChangeFrom('clinic-1', 'rule-1', 30);

    const expectedSlotIds = ['slot-1', 'slot-2'];
    expect(slots.countActiveAppointmentsBySlots).toHaveBeenCalledOnce();
    expect(slots.countActiveAppointmentsBySlots).toHaveBeenCalledWith('clinic-1', expectedSlotIds);
    expect(slots.countActiveHoldsBySlots).toHaveBeenCalledOnce();
    expect(slots.countActiveHoldsBySlots).toHaveBeenCalledWith('clinic-1', expectedSlotIds);
    expect(result).toEqual({ superseded_slots: 2, conflicts: [] });
    expect(slotGenerationService.generateSlots).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      doctorId: 'doctor-1',
      clinicServiceId: 'service-1',
    });
  });

  it('generates a target with bulk reads and one bulk slot insert', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T06:30:00.000Z'));

    const workingWindows = [
      {
        dayOfWeek: 0,
        startTime: '09:00:00',
        endTime: '10:00:00',
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
            bookingHorizonDays: 45,
            version: 2,
          },
        },
      ]),
      insertBatch: vi.fn().mockResolvedValue([{ id: 'batch-1' }]),
      listDoctorSchedules: vi.fn().mockResolvedValue(workingWindows),
      listClinicHours: vi.fn().mockResolvedValue(workingWindows),
      listClinicHolidays: vi.fn().mockResolvedValue([]),
      listDoctorBlockedSlots: vi.fn().mockResolvedValue([]),
      listExistingSlotWindows: vi.fn().mockResolvedValue([]),
      insertSlots: vi.fn(async (values: unknown[]) => values),
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

      expect(slots.listDoctorBlockedSlots).toHaveBeenCalledOnce();
      expect(slots.listExistingSlotWindows).toHaveBeenCalledOnce();
      expect(slots.insertSlots).toHaveBeenCalledOnce();
      expect(slots.insertSlots.mock.calls[0]?.[0]).toHaveLength(2);
      expect(result).toEqual([
        expect.objectContaining({
          clinic_id: 'clinic-1',
          doctor_id: 'doctor-1',
          clinic_service_id: 'service-1',
          inserted: 2,
          horizon_days: 0,
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
