import { describe, expect, it, vi } from 'vitest';

import { ClinicClinicalController } from '../src/modules/clinic-setup/clinic-clinical.controller';
import { DoctorHistoryService } from '../src/modules/clinic-setup/doctor-history.service';

function setup() {
  const clinicalSetup = {
    searchPatientsForHistory: vi.fn().mockResolvedValue([]),
    listVisitsForPatientHistory: vi.fn().mockResolvedValue([]),
    listAppointmentsForPatientHistory: vi.fn().mockResolvedValue([]),
  };
  const service = Object.create(DoctorHistoryService.prototype) as DoctorHistoryService;
  Object.defineProperty(service, 'repos', {
    value: {
      clinicalSetup,
      appointmentLifecycle: { markPastConfirmedNoShows: vi.fn().mockResolvedValue(0) },
    },
  });
  return { service, clinicalSetup };
}

describe('patient history appointment-date search', () => {
  it('allows searching by date alone and returns an empty list when nobody matches', async () => {
    const { service, clinicalSetup } = setup();
    await expect(service.searchPatientHistory('clinic-1', { date: '2026-11-14' })).resolves.toEqual(
      {
        patients: [],
      },
    );
    expect(clinicalSetup.searchPatientsForHistory).toHaveBeenCalledWith('clinic-1', {
      date: '2026-11-14',
      limit: 50,
    });
    expect(clinicalSetup.listVisitsForPatientHistory).not.toHaveBeenCalled();
  });

  it('combines the date with normalized phone, name, and age filters', async () => {
    const { service, clinicalSetup } = setup();
    await service.searchPatientHistory('clinic-1', {
      date: ' 2026-11-14 ',
      phone: '98765 43210',
      name: '  Aarti   Rao  ',
      age: 38,
    });
    expect(clinicalSetup.searchPatientsForHistory).toHaveBeenCalledWith('clinic-1', {
      date: '2026-11-14',
      phone: '9876543210',
      name: 'aarti rao',
      age: 38,
      limit: 50,
    });
  });

  it.each(['2024-02-29', '2000-02-29', '2026-12-31'])(
    'accepts the real calendar date %s',
    async (date) => {
      const { service, clinicalSetup } = setup();
      await service.searchPatientHistory('clinic-1', { date });
      expect(clinicalSetup.searchPatientsForHistory).toHaveBeenCalledWith('clinic-1', {
        date,
        limit: 50,
      });
    },
  );

  it.each([
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-14',
    '2026-11-00',
    '14/11/2026',
    '2026-1-4',
    '2026-11-14T00:00:00Z',
    '0000-01-01',
  ])('rejects an invalid date before querying: %s', async (date) => {
    const { service, clinicalSetup } = setup();
    await expect(service.searchPatientHistory('clinic-1', { date })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Date must be a valid calendar date in YYYY-MM-DD format.',
    });
    expect(clinicalSetup.searchPatientsForHistory).not.toHaveBeenCalled();
  });

  it('removes a previous date restriction when the next search omits or clears it', async () => {
    const { service, clinicalSetup } = setup();
    await service.searchPatientHistory('clinic-1', { name: 'Aarti', date: '2026-11-14' });
    await service.searchPatientHistory('clinic-1', { name: 'Aarti' });
    await service.searchPatientHistory('clinic-1', { name: 'Aarti', date: ' ' });
    expect(clinicalSetup.searchPatientsForHistory.mock.calls.slice(1)).toEqual([
      ['clinic-1', { name: 'aarti', limit: 50 }],
      ['clinic-1', { name: 'aarti', limit: 50 }],
    ]);
    await expect(service.searchPatientHistory('clinic-1', { date: '' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('keeps the complete patient timeline, including other dates and every appointment status', async () => {
    const { service, clinicalSetup } = setup();
    clinicalSetup.searchPatientsForHistory.mockResolvedValue([
      {
        id: 'patient-1',
        name: 'Aarti',
        phone: '9876543210',
        gender: null,
        ageYears: 38,
        dateOfBirth: null,
      },
    ]);
    const statuses = ['pending', 'confirmed', 'cancelled', 'no_show', 'visited'];
    clinicalSetup.listAppointmentsForPatientHistory.mockResolvedValue(
      statuses.map((status, index) => ({
        id: `appointment-${index}`,
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        doctorName: 'Doctor',
        clinicServiceId: 'service-1',
        clinicServiceName: 'Consultation',
        reasonForVisit: 'Consultation',
        appointmentStart: `2026-11-${10 + index}T09:00:00Z`,
        status,
      })),
    );

    const result = await service.searchPatientHistory('clinic-1', { date: '2026-11-14' });
    expect(clinicalSetup.listAppointmentsForPatientHistory).toHaveBeenCalledWith('clinic-1', [
      'patient-1',
    ]);
    expect(clinicalSetup.listVisitsForPatientHistory).toHaveBeenCalledWith('clinic-1', [
      'patient-1',
    ]);
    expect(result.patients[0]?.history.map((item) => item.status).sort()).toEqual(statuses.sort());
    expect(result.patients[0]?.history).toHaveLength(5);
  });
});

describe('patient history controller date forwarding', () => {
  it('passes the optional date to the service alongside the existing search fields', async () => {
    const searchPatientHistory = vi.fn().mockResolvedValue({ patients: [{ id: 'patient-1' }] });
    const controller = Object.create(
      ClinicClinicalController.prototype,
    ) as ClinicClinicalController;
    Object.defineProperty(controller, 'doctorHistoryService', {
      value: { searchPatientHistory },
    });

    await expect(
      controller.searchPatientHistory('clinic-1', '9876543210', 'Aarti', '38', '2026-11-14'),
    ).resolves.toEqual({ patients: [{ id: 'patient-1' }] });
    expect(searchPatientHistory).toHaveBeenLastCalledWith('clinic-1', {
      phone: '9876543210',
      name: 'Aarti',
      age: 38,
      date: '2026-11-14',
    });

    await controller.searchPatientHistory(
      'clinic-1',
      undefined,
      undefined,
      undefined,
      '2026-11-14',
    );
    expect(searchPatientHistory).toHaveBeenLastCalledWith('clinic-1', { date: '2026-11-14' });
    await controller.searchPatientHistory('clinic-1', undefined, 'Aarti');
    expect(searchPatientHistory).toHaveBeenLastCalledWith('clinic-1', { name: 'Aarti' });
  });
});
