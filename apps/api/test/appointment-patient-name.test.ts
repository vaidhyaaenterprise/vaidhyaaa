import { describe, expect, it, vi } from 'vitest';

import { AppointmentAdminService } from '../src/modules/appointment/appointment-admin.service';

function installPrivateDependency(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value });
}

function createHarness(patientId: string | null = 'patient-1') {
  const tx = { transaction: true };
  const appointment = {
    id: 'appointment-1',
    clinicId: 'clinic-1',
    patientId,
    patientName: 'Old Patient Name',
  };
  const updatedAppointment = { ...appointment, patientName: 'New Patient Name' };
  const appointmentLifecycle = {
    findAppointmentByIdForUpdate: vi.fn().mockResolvedValue([appointment]),
    updatePatientNameForAppointments: vi.fn().mockResolvedValue([
      updatedAppointment,
      { ...updatedAppointment, id: 'appointment-2' },
    ]),
    insertAppointmentEvent: vi.fn().mockResolvedValue([{ id: 'event-1' }]),
  };
  const patients = {
    updatePatient: vi.fn().mockResolvedValue([
      { id: 'patient-1', name: 'New Patient Name', normalizedName: 'new patient name' },
    ]),
  };
  const withTransaction = vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
    callback(tx),
  );
  const service = Object.create(AppointmentAdminService.prototype) as AppointmentAdminService;
  installPrivateDependency(service, 'repos', { appointmentLifecycle, patients });
  installPrivateDependency(service, 'dbService', { withTransaction });

  return { service, tx, appointment, updatedAppointment, appointmentLifecycle, patients };
}

describe('AppointmentAdminService.updatePatientName', () => {
  it('updates the canonical patient and every linked appointment in one transaction', async () => {
    const harness = createHarness();

    await expect(
      harness.service.updatePatientName({
        clinicId: 'clinic-1',
        appointmentId: 'appointment-1',
        patientName: '  New Patient Name  ',
        actorUserId: 'admin-1',
      }),
    ).resolves.toEqual({
      appointment: harness.updatedAppointment,
      updated_appointment_count: 2,
    });

    expect(harness.patients.updatePatient).toHaveBeenCalledWith(
      'clinic-1',
      'patient-1',
      { name: 'New Patient Name', normalizedName: 'new patient name' },
      harness.tx,
    );
    expect(harness.appointmentLifecycle.updatePatientNameForAppointments).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      'patient-1',
      'New Patient Name',
      harness.tx,
    );
    expect(harness.appointmentLifecycle.insertAppointmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'appointment.patient_name_updated',
        oldValuesJson: { patient_name: 'Old Patient Name' },
        newValuesJson: { patient_name: 'New Patient Name' },
      }),
      harness.tx,
    );
  });

  it('updates only the selected legacy appointment when no patient record is linked', async () => {
    const harness = createHarness(null);
    harness.appointmentLifecycle.updatePatientNameForAppointments.mockResolvedValue([
      harness.updatedAppointment,
    ]);

    await expect(
      harness.service.updatePatientName({
        clinicId: 'clinic-1',
        appointmentId: 'appointment-1',
        patientName: 'New Patient Name',
        actorUserId: 'admin-1',
      }),
    ).resolves.toMatchObject({ updated_appointment_count: 1 });

    expect(harness.patients.updatePatient).not.toHaveBeenCalled();
    expect(harness.appointmentLifecycle.updatePatientNameForAppointments).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      null,
      'New Patient Name',
      harness.tx,
    );
  });
});
