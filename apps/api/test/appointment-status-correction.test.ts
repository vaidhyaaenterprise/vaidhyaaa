import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthContext } from '@vaidya/shared';
import { RbacGuard } from '../src/common/guards/rbac.guard';
import { AUTH_CONTEXT_KEY } from '../src/common/guards/auth.guard';
import { AppointmentsController } from '../src/modules/appointment/appointments.controller';
import { AppointmentsService } from '../src/modules/appointment/appointments.service';
import { AppointmentLifecycleService } from '../src/modules/appointment/appointment-lifecycle.service';
import { AppointmentAdminService } from '../src/modules/appointment/appointment-admin.service';

function endpoint() {
  const correctStatus = vi
    .fn()
    .mockResolvedValue({ appointment: { id: 'appointment-1', status: 'visited' } });
  const controller = new AppointmentsController(
    {} as AppointmentsService,
    {} as AppointmentLifecycleService,
    { correctStatus } as unknown as AppointmentAdminService,
  );
  return { controller, correctStatus };
}
function context(auth: AuthContext): ExecutionContext {
  return {
    getHandler: () => AppointmentsController.prototype.updateAppointmentStatus,
    getClass: () => AppointmentsController,
    switchToHttp: () => ({
      getRequest: () => ({ [AUTH_CONTEXT_KEY]: auth, params: { clinicId: 'clinic-1' } }),
    }),
  } as unknown as ExecutionContext;
}
const auth: AuthContext = { userId: 'admin-1', clinicId: 'clinic-1', clinicRole: 'clinic_admin' };

describe('appointment status endpoint', () => {
  it.each(['confirmed', 'cancelled', 'no_show', 'visited'])(
    'passes only the requested %s status and authenticated actor',
    async (status) => {
      const { controller, correctStatus } = endpoint();
      await controller.updateAppointmentStatus('clinic-1', 'appointment-1', { status }, {
        [AUTH_CONTEXT_KEY]: auth,
      } as never);
      expect(correctStatus).toHaveBeenCalledWith({
        clinicId: 'clinic-1',
        appointmentId: 'appointment-1',
        status,
        actorUserId: 'admin-1',
      });
    },
  );
  it.each([
    { status: 'pending_confirmation' },
    { status: 'rescheduled' },
    { status: 'cancel' },
    { status: 'visited', patient_name: 'Changed' },
    { status: 'visited', appointment_start: '2026-12-01 09:00:00' },
    {},
  ])('rejects unsupported or non-status data: %j', async (payload) => {
    const { controller, correctStatus } = endpoint();
    await expect(
      controller.updateAppointmentStatus('clinic-1', 'appointment-1', payload, {
        [AUTH_CONTEXT_KEY]: auth,
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(correctStatus).not.toHaveBeenCalled();
  });
  it('enforces real route role metadata and clinic membership', () => {
    const guard = new RbacGuard(new Reflector());
    expect(guard.canActivate(context(auth))).toBe(true);
    expect(() =>
      guard.canActivate(context({ ...auth, clinicRole: 'doctor', doctorId: 'doctor-1' })),
    ).toThrow('permission');
    expect(() => guard.canActivate(context({ ...auth, clinicId: 'other-clinic' }))).toThrow(
      'Clinic access denied',
    );
  });
});

function correctionHarness() {
  const tx = {};
  const appointment = {
    id: 'appointment-1',
    clinicId: 'clinic-1',
    patientId: 'patient-1',
    patientName: 'Patient',
    doctorId: 'doctor-1',
    clinicServiceId: 'service-1',
    slotId: 'slot-1',
    status: 'cancelled',
    appointmentStart: '3000-01-01 09:00:00',
    appointmentEnd: '3000-01-01 09:30:00',
  };
  const slot = {
    id: 'slot-1',
    doctorId: 'doctor-1',
    clinicServiceId: 'service-1',
    status: 'open',
    capacityTotal: 1,
    startTime: appointment.appointmentStart,
    endTime: appointment.appointmentEnd,
  };
  const lifecycle = {
    findAppointmentById: vi.fn().mockResolvedValue([appointment]),
    findAppointmentByIdForUpdate: vi.fn().mockResolvedValue([appointment]),
    setCorrectedStatus: vi.fn(async (_c: string, _a: string, status: string) => [
      { ...appointment, status },
    ]),
    insertAppointmentEvent: vi.fn().mockResolvedValue([]),
    rejectPendingActionRequestsForAppointment: vi.fn().mockResolvedValue([]),
  };
  const slots = {
    findClinicTimezone: vi.fn().mockResolvedValue([{ timezone: 'Asia/Kolkata' }]),
    isDoctorHolidayForWindow: vi.fn().mockResolvedValue([]),
    countSlotLoad: vi.fn().mockResolvedValue({ activeAppointments: 0, activeHolds: 0 }),
  };
  const withTransaction = vi.fn((fn: (db: object) => Promise<unknown>) => fn(tx));
  const withSlotForUpdate = vi.fn(
    (_c: string, _s: string, fn: (s: typeof slot, db: object) => Promise<unknown>) => fn(slot, tx),
  );
  const service = Object.create(AppointmentAdminService.prototype) as AppointmentAdminService;
  Object.defineProperty(service, 'repos', { value: { appointmentLifecycle: lifecycle, slots } });
  Object.defineProperty(service, 'dbService', { value: { withTransaction, withSlotForUpdate } });
  return { service, appointment, slot, lifecycle, slots, tx, withTransaction, withSlotForUpdate };
}
const correctionInput = {
  clinicId: 'clinic-1',
  appointmentId: 'appointment-1',
  actorUserId: 'admin-1',
};
describe('status correction transaction', () => {
  it.each(['confirmed', 'cancelled', 'no_show', 'visited'] as const)(
    'writes only status %s plus audit data and keeps clinical records untouched',
    async (status) => {
      const h = correctionHarness();
      h.appointment.appointmentStart = '2000-01-01 09:00:00';
      h.appointment.appointmentEnd = '2000-01-01 09:30:00';
      h.appointment.status = status === 'confirmed' ? 'no_show' : 'confirmed';
      await expect(h.service.correctStatus({ ...correctionInput, status })).resolves.toEqual({
        appointment: { ...h.appointment, status },
      });
      expect(h.lifecycle.setCorrectedStatus).toHaveBeenCalledWith(
        'clinic-1',
        'appointment-1',
        status,
        h.tx,
      );
      expect(h.lifecycle.insertAppointmentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-1',
          eventType: 'appointment.status_corrected',
          oldValuesJson: { status: h.appointment.status },
          newValuesJson: { status, appointment_start: h.appointment.appointmentStart },
        }),
        h.tx,
      );
      expect(h.withSlotForUpdate).not.toHaveBeenCalled();
    },
  );
  it('locks a future slot before the appointment, and refuses held/full capacity', async () => {
    const h = correctionHarness();
    await h.service.correctStatus({ ...correctionInput, status: 'confirmed' });
    expect(h.withSlotForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      h.lifecycle.findAppointmentByIdForUpdate.mock.invocationCallOrder[0]!,
    );
    expect(h.slots.countSlotLoad).toHaveBeenCalledWith('clinic-1', 'slot-1', {}, h.tx);
    h.lifecycle.setCorrectedStatus.mockClear();
    h.slots.countSlotLoad.mockResolvedValue({ activeAppointments: 0, activeHolds: 1 });
    await expect(
      h.service.correctStatus({ ...correctionInput, status: 'confirmed' }),
    ).rejects.toMatchObject({ code: 'SLOT_FULL' });
    expect(h.lifecycle.setCorrectedStatus).not.toHaveBeenCalled();
  });
  it('also checks capacity when restoring an appointment whose time is still in progress', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T04:00:00Z')); // 09:30 clinic time.
    try {
      const h = correctionHarness();
      h.appointment.appointmentStart = h.slot.startTime = '2026-11-14 09:15:00';
      h.appointment.appointmentEnd = h.slot.endTime = '2026-11-14 09:45:00';
      h.slots.countSlotLoad.mockResolvedValue({ activeAppointments: 1, activeHolds: 0 });
      await expect(
        h.service.correctStatus({ ...correctionInput, status: 'confirmed' }),
      ).rejects.toMatchObject({ code: 'SLOT_FULL' });
      expect(h.withSlotForUpdate).toHaveBeenCalledOnce();
      expect(h.lifecycle.setCorrectedStatus).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects missing appointments and stale corrections without writes', async () => {
    const h = correctionHarness();
    h.lifecycle.findAppointmentById.mockResolvedValueOnce([]);
    await expect(
      h.service.correctStatus({ ...correctionInput, status: 'visited' }),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });
    h.lifecycle.findAppointmentByIdForUpdate.mockResolvedValue([
      { ...h.appointment, status: 'no_show' },
    ]);
    await expect(
      h.service.correctStatus({ ...correctionInput, status: 'visited' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(h.lifecycle.setCorrectedStatus).not.toHaveBeenCalled();
  });
  it('does not duplicate writes for the existing status', async () => {
    const h = correctionHarness();
    await h.service.correctStatus({ ...correctionInput, status: 'cancelled' });
    expect(h.lifecycle.setCorrectedStatus).not.toHaveBeenCalled();
    expect(h.lifecycle.insertAppointmentEvent).not.toHaveBeenCalled();
  });
});
