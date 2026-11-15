import { describe, expect, it, vi } from 'vitest';
import { DoctorHistoryService } from '../src/modules/clinic-setup/doctor-history.service';

function setup(status: string) {
  const visit = {
    id: 'visit-1',
    appointmentStatus: null as string | null,
    patientId: 'patient-1',
    appointmentRequestId: 'appointment-1',
    doctorId: 'doctor-1',
    doctorName: 'Doctor',
    clinicServiceId: 'service-1',
    clinicServiceName: 'Consultation',
    reasonForVisit: 'Recorded reason',
    examinationNotes: 'Preserved examination',
    diagnosis: 'Preserved diagnosis',
    advice: 'Preserved advice',
    visitedAt: new Date('2026-11-12T04:00:00Z'),
  };
  const markPastConfirmedNoShows = vi.fn().mockResolvedValue(1);
  const clinicalSetup = {
    searchPatientsForHistory: vi.fn().mockResolvedValue([
      {
        id: 'patient-1',
        name: 'Patient',
        phone: '9876543210',
        gender: null,
        ageYears: 40,
        dateOfBirth: null,
      },
    ]),
    listVisitsForPatientHistory: vi
      .fn()
      .mockResolvedValue([visit, { ...visit, id: 'unlinked', appointmentRequestId: null }]),
    listAppointmentsForPatientHistory: vi.fn().mockResolvedValue([
      {
        id: 'appointment-1',
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        doctorName: 'Doctor',
        clinicServiceId: 'service-1',
        clinicServiceName: 'Consultation',
        reasonForVisit: 'Booking reason',
        appointmentStart: '2026-11-12T03:30:00Z',
        status,
      },
    ]),
  };
  const service = Object.create(DoctorHistoryService.prototype) as DoctorHistoryService;
  Object.defineProperty(service, 'repos', {
    value: { clinicalSetup, appointmentLifecycle: { markPastConfirmedNoShows } },
  });
  return { service, visit, clinicalSetup, markPastConfirmedNoShows };
}

describe('patient history status projection', () => {
  it.each(['confirmed', 'cancelled', 'no_show', 'visited'])(
    'synchronizes linked visit and appointment %s status while preserving clinical details',
    async (status) => {
      const h = setup(status);
      const result = await h.service.searchPatientHistory('clinic-1', { phone: '9876543210' });
      const history = result.patients[0]!.history;
      expect(history.find((row) => row.kind === 'appointment')).toMatchObject({
        id: 'appointment-1',
        status,
        reason_for_visit: 'Booking reason',
      });
      expect(history.find((row) => row.id === 'visit-1')).toMatchObject({
        status,
        appointment_request_id: 'appointment-1',
        examination_notes: 'Preserved examination',
        diagnosis: 'Preserved diagnosis',
        advice: 'Preserved advice',
        at: h.visit.visitedAt.toISOString(),
      });
      const unlinked = history.find((row) => row.id === 'unlinked');
      expect(unlinked?.appointment_request_id).toBeNull();
      expect(unlinked).not.toHaveProperty('status');
      expect(h.markPastConfirmedNoShows).toHaveBeenCalledWith('clinic-1');
      expect(h.markPastConfirmedNoShows.mock.invocationCallOrder[0]).toBeLessThan(
        h.clinicalSetup.listAppointmentsForPatientHistory.mock.invocationCallOrder[0]!,
      );
    },
  );
  it('uses the joined appointment status when a legacy visit links an appointment outside the patient-id list', async () => {
    const h = setup('confirmed');
    h.clinicalSetup.listAppointmentsForPatientHistory.mockResolvedValue([]);
    h.clinicalSetup.listVisitsForPatientHistory.mockResolvedValue([
      { ...h.visit, appointmentStatus: 'cancelled' },
    ]);
    const result = await h.service.searchPatientHistory('clinic-1', { phone: '9876543210' });
    expect(result.patients[0]!.history[0]).toMatchObject({
      kind: 'visit',
      status: 'cancelled',
      examination_notes: 'Preserved examination',
    });
  });
  it('does not reconcile unrelated records for an empty patient search', async () => {
    const h = setup('confirmed');
    h.clinicalSetup.searchPatientsForHistory.mockResolvedValue([]);
    await expect(
      h.service.searchPatientHistory('clinic-1', { phone: '9876543210' }),
    ).resolves.toEqual({ patients: [] });
    expect(h.markPastConfirmedNoShows).not.toHaveBeenCalled();
    expect(h.clinicalSetup.listVisitsForPatientHistory).not.toHaveBeenCalled();
  });
});
