import { describe, expect, it, vi } from 'vitest';

import { AppointmentLifecycleService } from '../src/modules/appointment/appointment-lifecycle.service';

function installPrivateDependency(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value });
}

function createAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appointment-1',
    clinicId: 'clinic-1',
    doctorId: 'doctor-1',
    clinicServiceId: 'service-1',
    slotId: 'slot-old',
    slotHoldId: 'hold-old',
    appointmentStart: '2026-09-22 09:00:00',
    appointmentEnd: '2026-09-22 09:30:00',
    patientPhone: '9876543210',
    status: 'confirmed',
    ...overrides,
  };
}

function createTargetSlot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'slot-new',
    clinicId: 'clinic-1',
    doctorId: 'doctor-1',
    clinicServiceId: 'service-1',
    startTime: '2026-09-22 10:00:00',
    endTime: '2026-09-22 10:30:00',
    capacityTotal: 1,
    status: 'open',
    ...overrides,
  };
}

function createHarness(input?: {
  appointment?: ReturnType<typeof createAppointment>;
  targetSlot?: ReturnType<typeof createTargetSlot>;
  slotLoad?: { activeAppointments: number; activeHolds: number };
  reservationHold?: Record<string, unknown>;
}) {
  const tx = { transaction: true };
  const appointment = input?.appointment ?? createAppointment();
  const targetSlot = input?.targetSlot ?? createTargetSlot();
  const updatedAppointment = {
    ...appointment,
    slotId: targetSlot.id,
    appointmentStart: targetSlot.startTime,
    appointmentEnd: targetSlot.endTime,
  };
  const appointmentLifecycle = {
    findAppointmentByIdForUpdate: vi.fn().mockResolvedValue([appointment]),
    insertAppointmentEvent: vi.fn().mockResolvedValue([]),
  };
  const slots = {
    findActiveHoldForSession: vi
      .fn()
      .mockResolvedValue(input?.reservationHold ? [input.reservationHold] : []),
    isDoctorHolidayForWindow: vi.fn().mockResolvedValue([]),
    countSlotLoad: vi
      .fn()
      .mockResolvedValue(input?.slotLoad ?? { activeAppointments: 0, activeHolds: 0 }),
    findHoldById: vi.fn().mockResolvedValue([{ id: 'hold-old', status: 'active' }]),
    updateHoldStatus: vi.fn().mockResolvedValue([]),
    updateAppointmentSlotAndTime: vi.fn().mockResolvedValue([updatedAppointment]),
  };
  const withSlotForUpdate = vi.fn(
    async (
      _clinicId: string,
      _slotId: string,
      callback: (slot: typeof targetSlot, transaction: typeof tx) => Promise<unknown>,
    ) => callback(targetSlot, tx),
  );
  const notifyPatientAppointmentRescheduled = vi.fn().mockResolvedValue(undefined);
  const service = Object.create(
    AppointmentLifecycleService.prototype,
  ) as AppointmentLifecycleService;

  installPrivateDependency(service, 'repos', { appointmentLifecycle, slots });
  installPrivateDependency(service, 'dbService', { withSlotForUpdate });
  installPrivateDependency(service, 'notificationOutbox', {
    notifyPatientAppointmentRescheduled,
  });

  return {
    service,
    tx,
    appointment,
    targetSlot,
    updatedAppointment,
    appointmentLifecycle,
    slots,
    withSlotForUpdate,
    notifyPatientAppointmentRescheduled,
  };
}

describe('AppointmentLifecycleService reschedule capacity', () => {
  it('rejects a full target slot without moving the appointment', async () => {
    const harness = createHarness({
      slotLoad: { activeAppointments: 1, activeHolds: 0 },
    });

    await expect(
      harness.service.rescheduleAppointmentTime({
        clinicId: 'clinic-1',
        appointmentId: 'appointment-1',
        newSlotId: 'slot-new',
        actorUserId: 'admin-1',
      }),
    ).rejects.toMatchObject({
      code: 'SLOT_FULL',
      message: 'Slot is full for that time.',
    });

    expect(harness.slots.updateAppointmentSlotAndTime).not.toHaveBeenCalled();
    expect(harness.slots.updateHoldStatus).not.toHaveBeenCalled();
    expect(harness.appointmentLifecycle.insertAppointmentEvent).not.toHaveBeenCalled();
    expect(harness.notifyPatientAppointmentRescheduled).not.toHaveBeenCalled();
  });

  it('atomically moves the appointment and releases its old active hold association', async () => {
    const harness = createHarness();

    await expect(
      harness.service.rescheduleAppointmentTime({
        clinicId: 'clinic-1',
        appointmentId: 'appointment-1',
        newSlotId: 'slot-new',
        actorUserId: 'admin-1',
      }),
    ).resolves.toEqual(harness.updatedAppointment);

    expect(harness.appointmentLifecycle.findAppointmentByIdForUpdate).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      harness.tx,
    );
    expect(harness.withSlotForUpdate).toHaveBeenCalledWith(
      'clinic-1',
      'slot-new',
      expect.any(Function),
    );
    expect(harness.slots.updateHoldStatus).toHaveBeenCalledWith(
      'clinic-1',
      'hold-old',
      'released',
      harness.tx,
    );
    expect(harness.slots.updateAppointmentSlotAndTime).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      {
        slotId: 'slot-new',
        slotHoldId: null,
        appointmentStart: '2026-09-22 10:00:00',
        appointmentEnd: '2026-09-22 10:30:00',
      },
      harness.tx,
    );
    expect(harness.appointmentLifecycle.insertAppointmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'appointment.rescheduled',
        actorUserId: 'admin-1',
        oldValuesJson: expect.objectContaining({
          slot_id: 'slot-old',
          slot_hold_id: 'hold-old',
        }),
        newValuesJson: expect.objectContaining({
          slot_id: 'slot-new',
          slot_hold_id: null,
        }),
      }),
      harness.tx,
    );
    expect(harness.notifyPatientAppointmentRescheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: 'clinic-1',
        appointmentId: 'appointment-1',
        patientPhone: '9876543210',
      }),
    );
  });

  it('does not count its own reservation hold and converts that hold after the move', async () => {
    const reservationHold = {
      id: 'hold-new',
      slotId: 'slot-new',
      status: 'active',
    };
    const harness = createHarness({
      reservationHold,
      slotLoad: { activeAppointments: 0, activeHolds: 0 },
    });

    await harness.service.rescheduleAppointmentTime({
      clinicId: 'clinic-1',
      appointmentId: 'appointment-1',
      newSlotId: 'slot-new',
      actorUserId: 'admin-1',
      reservationSessionId: 'session-1',
    });

    expect(harness.slots.findActiveHoldForSession).toHaveBeenCalledWith(
      'clinic-1',
      'session-1',
      harness.tx,
    );
    expect(harness.slots.countSlotLoad).toHaveBeenCalledWith(
      'clinic-1',
      'slot-new',
      { excludeHoldId: 'hold-new' },
      harness.tx,
    );
    expect(harness.slots.updateAppointmentSlotAndTime).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      expect.objectContaining({ slotId: 'slot-new', slotHoldId: 'hold-new' }),
      harness.tx,
    );
    expect(harness.slots.updateHoldStatus).toHaveBeenNthCalledWith(
      1,
      'clinic-1',
      'hold-old',
      'released',
      harness.tx,
    );
    expect(harness.slots.updateHoldStatus).toHaveBeenNthCalledWith(
      2,
      'clinic-1',
      'hold-new',
      'converted',
      harness.tx,
    );
  });
});
