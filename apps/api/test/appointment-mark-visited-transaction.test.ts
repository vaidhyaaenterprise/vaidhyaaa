import { describe, expect, it, vi } from 'vitest';

import { AppointmentAdminService } from '../src/modules/appointment/appointment-admin.service';

function installPrivateDependency(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value });
}

function createHarness(status: 'confirmed' | 'visited' = 'confirmed') {
  const tx = { transaction: true };
  const appointment = {
    id: 'appointment-1',
    clinicId: 'clinic-1',
    patientId: null,
    patientName: 'Patient One',
    patientPhone: '+91 98765 43210',
    doctorId: 'doctor-1',
    clinicServiceId: 'service-1',
    status,
  };
  const patient = { id: 'patient-1' };
  const patientVisit = { id: 'visit-1', appointmentRequestId: appointment.id };
  const updatedAppointment = { ...appointment, patientId: patient.id, status: 'visited' };
  const appointmentLifecycle = {
    findAppointmentByIdForUpdate: vi.fn().mockResolvedValue([appointment]),
    insertAppointmentEvent: vi.fn().mockResolvedValue([{ id: 'event-1' }]),
  };
  const patients = {
    upsertByPhone: vi.fn().mockResolvedValue([patient]),
    insertVisit: vi.fn().mockResolvedValue([patientVisit]),
  };
  const slots = {
    updateAppointmentStatus: vi.fn().mockResolvedValue([updatedAppointment]),
  };
  const withTransaction = vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
    callback(tx),
  );
  const service = Object.create(AppointmentAdminService.prototype) as AppointmentAdminService;

  installPrivateDependency(service, 'repos', { appointmentLifecycle, patients, slots });
  installPrivateDependency(service, 'dbService', { withTransaction });

  return {
    service,
    tx,
    appointment,
    patient,
    patientVisit,
    updatedAppointment,
    appointmentLifecycle,
    patients,
    slots,
    withTransaction,
  };
}

describe('AppointmentAdminService.markVisited', () => {
  it('locks the appointment and writes the patient, visit, status, and event in one transaction', async () => {
    const harness = createHarness();

    await expect(
      harness.service.markVisited({
        clinicId: 'clinic-1',
        appointmentId: 'appointment-1',
        visitReason: 'Consultation completed',
        diagnosis: 'Resolved',
        actorUserId: 'admin-1',
        actorClinicRole: 'clinic_admin',
      }),
    ).resolves.toEqual({
      appointment: harness.updatedAppointment,
      patient_visit: harness.patientVisit,
    });

    expect(harness.withTransaction).toHaveBeenCalledOnce();
    expect(harness.appointmentLifecycle.findAppointmentByIdForUpdate).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      harness.tx,
    );
    expect(harness.patients.upsertByPhone).toHaveBeenCalledWith(
      {
        clinicId: 'clinic-1',
        name: 'Patient One',
        phone: '+91 98765 43210',
        normalizedPhone: '919876543210',
      },
      harness.tx,
    );
    expect(harness.patients.insertVisit).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: 'clinic-1',
        patientId: harness.patient.id,
        appointmentRequestId: 'appointment-1',
        reasonForVisit: 'Consultation completed',
        diagnosis: 'Resolved',
      }),
      harness.tx,
    );
    expect(harness.slots.updateAppointmentStatus).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      'visited',
      harness.tx,
    );
    expect(harness.appointmentLifecycle.insertAppointmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentRequestId: 'appointment-1',
        eventType: 'appointment.visited',
        oldValuesJson: { status: 'confirmed' },
        newValuesJson: expect.objectContaining({
          status: 'visited',
          visit_reason: 'Consultation completed',
        }),
      }),
      harness.tx,
    );
  });

  it('does not create a duplicate visit after the row lock observes an already-visited appointment', async () => {
    const harness = createHarness('visited');

    await expect(
      harness.service.markVisited({
        clinicId: 'clinic-1',
        appointmentId: 'appointment-1',
        visitReason: 'Duplicate submission',
        actorUserId: 'admin-1',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Only confirmed appointments can be marked visited.',
    });

    expect(harness.appointmentLifecycle.findAppointmentByIdForUpdate).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      harness.tx,
    );
    expect(harness.patients.upsertByPhone).not.toHaveBeenCalled();
    expect(harness.patients.insertVisit).not.toHaveBeenCalled();
    expect(harness.slots.updateAppointmentStatus).not.toHaveBeenCalled();
    expect(harness.appointmentLifecycle.insertAppointmentEvent).not.toHaveBeenCalled();
  });
});
