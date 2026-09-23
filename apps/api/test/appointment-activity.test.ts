import { describe, expect, it, vi } from 'vitest';

import type { AuthContext } from '@vaidya/shared';

import { AUTH_CONTEXT_KEY } from '../src/common/guards/auth.guard';
import { AppointmentAdminService } from '../src/modules/appointment/appointment-admin.service';
import { AppointmentLifecycleService } from '../src/modules/appointment/appointment-lifecycle.service';
import { AppointmentsController } from '../src/modules/appointment/appointments.controller';
import { AppointmentsService } from '../src/modules/appointment/appointments.service';

function installPrivateDependency(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value });
}

function createCancellationHarness(status: 'confirmed' | 'cancelled' = 'confirmed') {
  const tx = { transaction: true };
  const appointment = {
    id: 'appointment-1',
    patientPhone: '9876543210',
    status,
  };
  const updatedAppointment = { ...appointment, status: 'cancelled' };
  const appointmentLifecycle = {
    findAppointmentByIdForUpdate: vi.fn().mockResolvedValue([appointment]),
    rejectPendingActionRequestsForAppointment: vi.fn().mockResolvedValue([]),
    insertAppointmentEvent: vi.fn().mockResolvedValue([]),
  };
  const slots = {
    updateAppointmentStatus: vi.fn().mockResolvedValue([updatedAppointment]),
  };
  let transactionFinished = false;
  const notifyPatientAppointmentCancelled = vi.fn(async () => {
    expect(transactionFinished).toBe(true);
  });
  const withTransaction = vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    const result = await callback(tx);
    expect(notifyPatientAppointmentCancelled).not.toHaveBeenCalled();
    transactionFinished = true;
    return result;
  });
  const service = Object.create(
    AppointmentLifecycleService.prototype,
  ) as AppointmentLifecycleService;

  installPrivateDependency(service, 'repos', { appointmentLifecycle, slots });
  installPrivateDependency(service, 'dbService', { withTransaction });
  installPrivateDependency(service, 'notificationOutbox', {
    notifyPatientAppointmentCancelled,
  });

  return {
    service,
    tx,
    appointment,
    updatedAppointment,
    appointmentLifecycle,
    slots,
    withTransaction,
    notifyPatientAppointmentCancelled,
  };
}

describe('appointment activity', () => {
  it('maps clinic-admin reschedule and cancellation events into activity rows', async () => {
    const listClinicAdminAppointmentActivities = vi.fn().mockResolvedValue([
      {
        id: 'event-reschedule',
        appointmentId: 'appointment-1',
        patientName: 'Patient One',
        patientPhone: '9876543210',
        doctorId: 'doctor-1',
        doctorName: 'Doctor One',
        clinicServiceId: 'service-1',
        serviceName: 'General Consultation',
        reasonForVisit: 'Fever',
        eventType: 'appointment.rescheduled',
        occurredAt: new Date('2026-09-23T08:00:00.000Z'),
        oldValuesJson: {
          appointment_start: '2026-09-23 09:00:00',
          appointment_end: '2026-09-23 09:30:00',
        },
        newValuesJson: {
          appointment_start: '2026-09-24 10:00:00',
          appointment_end: '2026-09-24 10:30:00',
        },
        appointmentStart: '2026-09-24 10:00:00',
        appointmentEnd: '2026-09-24 10:30:00',
      },
      {
        id: 'event-cancel',
        appointmentId: 'appointment-2',
        patientName: 'Patient Two',
        patientPhone: null,
        doctorId: 'doctor-2',
        doctorName: 'Doctor Two',
        clinicServiceId: 'service-2',
        serviceName: 'Dental Consultation',
        reasonForVisit: 'Tooth pain',
        eventType: 'appointment.cancelled',
        occurredAt: new Date('2026-09-23T07:00:00.000Z'),
        oldValuesJson: { status: 'confirmed' },
        newValuesJson: { status: 'cancelled' },
        appointmentStart: '2026-09-25 11:00:00',
        appointmentEnd: '2026-09-25 11:30:00',
      },
    ]);
    const service = Object.create(AppointmentsService.prototype) as AppointmentsService;
    installPrivateDependency(service, 'repos', {
      appointmentLifecycle: { listClinicAdminAppointmentActivities },
    });

    await expect(service.listAppointmentActivities('clinic-1')).resolves.toEqual([
      {
        id: 'event-reschedule',
        appointment_id: 'appointment-1',
        patient_name: 'Patient One',
        patient_phone: '9876543210',
        doctor_id: 'doctor-1',
        doctor_name: 'Doctor One',
        clinic_service_id: 'service-1',
        service_name: 'General Consultation',
        reason_for_visit: 'Fever',
        action_type: 'reschedule',
        occurred_at: '2026-09-23T08:00:00.000Z',
        previous_appointment_start: '2026-09-23 09:00:00',
        previous_appointment_end: '2026-09-23 09:30:00',
        appointment_start: '2026-09-24 10:00:00',
        appointment_end: '2026-09-24 10:30:00',
      },
      {
        id: 'event-cancel',
        appointment_id: 'appointment-2',
        patient_name: 'Patient Two',
        patient_phone: null,
        doctor_id: 'doctor-2',
        doctor_name: 'Doctor Two',
        clinic_service_id: 'service-2',
        service_name: 'Dental Consultation',
        reason_for_visit: 'Tooth pain',
        action_type: 'cancel',
        occurred_at: '2026-09-23T07:00:00.000Z',
        previous_appointment_start: null,
        previous_appointment_end: null,
        appointment_start: '2026-09-25 11:00:00',
        appointment_end: '2026-09-25 11:30:00',
      },
    ]);
    expect(listClinicAdminAppointmentActivities).toHaveBeenCalledWith('clinic-1');
  });

  it('passes the authenticated admin user to direct confirm and cancel lifecycle calls', async () => {
    const confirmAppointment = vi.fn().mockResolvedValue({ id: 'appointment-1' });
    const cancelAppointment = vi.fn().mockResolvedValue({ id: 'appointment-1' });
    const lifecycleService = {
      confirmAppointment,
      cancelAppointment,
    } as unknown as AppointmentLifecycleService;
    const controller = new AppointmentsController(
      {} as AppointmentsService,
      lifecycleService,
      {} as AppointmentAdminService,
    );
    const auth: AuthContext = {
      userId: '00000000-0000-0000-0000-000000000101',
      clinicId: '00000000-0000-0000-0000-000000000001',
      clinicRole: 'clinic_admin',
    };
    const request = { [AUTH_CONTEXT_KEY]: auth } as Parameters<
      AppointmentsController['confirmAppointment']
    >[2];

    await controller.confirmAppointment('clinic-1', 'appointment-1', request);
    await controller.cancelAppointment('clinic-1', 'appointment-1', request);

    expect(confirmAppointment).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      appointmentId: 'appointment-1',
      actorUserId: auth.userId,
    });
    expect(cancelAppointment).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      appointmentId: 'appointment-1',
      actorUserId: auth.userId,
    });
  });

  it('cancels and records activity in one transaction before notifying the patient', async () => {
    const harness = createCancellationHarness();

    await expect(
      harness.service.cancelAppointment({
        clinicId: 'clinic-1',
        appointmentId: 'appointment-1',
        actorUserId: 'admin-1',
      }),
    ).resolves.toEqual(harness.updatedAppointment);

    expect(harness.withTransaction).toHaveBeenCalledOnce();
    expect(harness.appointmentLifecycle.findAppointmentByIdForUpdate).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      harness.tx,
    );
    expect(harness.slots.updateAppointmentStatus).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      'cancelled',
      harness.tx,
    );
    expect(
      harness.appointmentLifecycle.rejectPendingActionRequestsForAppointment,
    ).toHaveBeenCalledWith('clinic-1', 'appointment-1', harness.tx);
    expect(harness.appointmentLifecycle.insertAppointmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentRequestId: 'appointment-1',
        eventType: 'appointment.cancelled',
        actorType: 'clinic_admin',
        actorUserId: 'admin-1',
        oldValuesJson: { status: 'confirmed' },
        newValuesJson: { status: 'cancelled' },
      }),
      harness.tx,
    );
    expect(harness.notifyPatientAppointmentCancelled).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      appointmentId: 'appointment-1',
      patientPhone: '9876543210',
    });
  });

  it('keeps an already-cancelled appointment idempotent while holding the row lock', async () => {
    const harness = createCancellationHarness('cancelled');

    await expect(
      harness.service.cancelAppointment({
        clinicId: 'clinic-1',
        appointmentId: 'appointment-1',
        actorUserId: 'admin-1',
      }),
    ).resolves.toEqual(harness.appointment);

    expect(harness.appointmentLifecycle.findAppointmentByIdForUpdate).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      harness.tx,
    );
    expect(harness.slots.updateAppointmentStatus).not.toHaveBeenCalled();
    expect(
      harness.appointmentLifecycle.rejectPendingActionRequestsForAppointment,
    ).not.toHaveBeenCalled();
    expect(harness.appointmentLifecycle.insertAppointmentEvent).not.toHaveBeenCalled();
    expect(harness.notifyPatientAppointmentCancelled).not.toHaveBeenCalled();
  });
});
