import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { SarvamToolsController } from '../src/modules/sarvam-tools/sarvam-tools.controller';

const req = { headers: {} } as FastifyRequest;
const date = '2026-11-02';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T06:00:00Z'));
});
afterEach(() => vi.useRealTimers());

function setup() {
  const controller = Object.create(SarvamToolsController.prototype) as SarvamToolsController;
  const callbacks = vi.fn().mockResolvedValue([{ id: 'callback-1' }]);
  const schedules = vi.fn().mockResolvedValue([
    {
      active: true,
      dayOfWeek: 1,
      startTime: '09:00:00',
      endTime: '13:00:00',
      effectiveFrom: null,
      effectiveTo: null,
    },
  ]);
  const mappings = vi.fn().mockResolvedValue([
    { doctorId: 'a', doctorName: 'Dr. Arun', qualification: 'MBBS', clinicServiceId: 'general' },
    { doctorId: 'b', doctorName: 'Dr. Bala', qualification: 'MD', clinicServiceId: 'general' },
    { doctorId: 'c', doctorName: 'Dr. Skin', qualification: null, clinicServiceId: 'skin' },
  ]);
  Object.defineProperties(controller, {
    repos: {
      value: {
        clinical: {
          listServices: vi.fn().mockResolvedValue([
            {
              id: 'general',
              active: true,
              serviceName: 'General Consultation',
              serviceKey: 'general_consultation',
            },
            {
              id: 'skin',
              active: true,
              serviceName: 'Skin Consultation',
              serviceKey: 'dermatology_consultation',
            },
          ]),
          listActiveDoctorServices: mappings,
        },
        clinics: { getClinicLocation: vi.fn().mockResolvedValue([{ timezone: 'Asia/Kolkata' }]) },
        patients: { upsertByPhone: vi.fn().mockResolvedValue([{ id: 'patient-1' }]) },
        slots: { findSlotByExactTime: vi.fn().mockResolvedValue([{ id: 'a-slot' }]) },
        appointmentLifecycle: { insertCallbackRequest: callbacks },
        doctors: { findDoctorById: vi.fn().mockResolvedValue([{ id: 'a', name: 'Dr. Arun' }]) },
        clinicalSetup: { listDoctorSchedules: schedules },
      },
    },
    slotService: {
      value: {
        findAvailableSlots: vi.fn(async (_clinic: string, doctor: string) => [
          {
            slot_id: `${doctor}-slot`,
            start_time: `${date} 18:00:00`,
            end_time: `${date} 18:30:00`,
            available_count: 1,
          },
        ]),
      },
    },
    bookingAppointmentService: {
      value: {
        createAppointmentFromFreshHold: vi.fn().mockResolvedValue({
          appointment: { id: 'appointment-1', status: 'confirmed' },
          hold: { id: 'hold-1' },
        }),
      },
    },
    staffNotification: { value: { notifyStaffActionRequest: vi.fn() } },
  });
  return { controller, mappings, callbacks, schedules };
}

describe('Sarvam scalar response fields for saved variables', () => {
  it('validates the agent-mapped key and provides doctor choices as one string', async () => {
    const { controller } = setup();
    expect(
      await controller.recommendService(
        { clinic_id: 'clinic-1', service_key: 'general_consultation' },
        req,
      ),
    ).toMatchObject({
      matched: true,
      error: '',
      doctorSelection: 'pending_availability',
      doctorId: null,
      doctorChoicesText: 'Dr. Arun (MBBS) | doctor_id=a\nDr. Bala (MD) | doctor_id=b',
      availableServicesText: 'General Consultation, Skin Consultation',
      serviceChoicesText:
        'General Consultation | service_key=general_consultation | clinic_service_id=general',
    });
  });

  it('returns only compatible doctor choices as text after a requested-doctor mismatch', async () => {
    const { controller } = setup();
    const result = await controller.recommendService(
      {
        clinic_id: 'clinic-1',
        service_key: 'general_consultation',
        doctor_name: 'Skin',
      },
      req,
    );
    expect(result).toMatchObject({
      matched: false,
      error: 'doctor_service_mismatch',
      doctorChoicesText: 'Dr. Arun (MBBS) | doctor_id=a\nDr. Bala (MD) | doctor_id=b',
    });
    expect('doctorChoicesText' in result && result.doctorChoicesText).not.toContain('doctor_id=c');
  });

  it('gives same-name candidates real IDs and qualifications without requiring an array variable', async () => {
    const { controller, mappings } = setup();
    mappings.mockResolvedValue([
      { doctorId: 'a', doctorName: 'Dr. Ravi', qualification: 'MBBS', clinicServiceId: 'general' },
      { doctorId: 'b', doctorName: 'Dr. Ravi', qualification: 'MD', clinicServiceId: 'general' },
    ]);
    expect(
      await controller.recommendService(
        {
          clinic_id: 'clinic-1',
          service_key: 'general_consultation',
          doctor_name: 'Ravi',
        },
        req,
      ),
    ).toMatchObject({
      matched: false,
      error: 'doctor_ambiguous',
      doctorChoicesText: 'Dr. Ravi (MBBS) | doctor_id=a\nDr. Ravi (MD) | doctor_id=b',
    });
  });

  it('reports an unavailable mapped key through a saved error string and actual service names', async () => {
    expect(
      await setup().controller.recommendService(
        {
          clinic_id: 'clinic-1',
          service_key: 'dental_consultation',
        },
        req,
      ),
    ).toMatchObject({
      matched: false,
      error: 'service_not_found',
      availableServicesText: 'General Consultation, Skin Consultation',
    });
  });

  it('makes overview choices and rejected IDs available as strings', async () => {
    const { controller } = setup();
    const result = await controller.checkSlots(
      {
        clinic_id: 'clinic-1',
        service_key: 'general_consultation',
        mode: 'overview',
        date,
        exclude_doctor_ids: 'a',
      },
      req,
    );
    expect(result).toMatchObject({
      success: true,
      error: '',
      availabilityStatus: 'overview',
      excludedDoctorIdsText: 'a',
      availabilityText: `Dr. Bala: ${date}: 18:00`,
      availabilityChoicesText: `Dr. Bala (MD) | doctor_id=b | ${date}: 18:00`,
    });
    expect(result).not.toHaveProperty('slots');
  });

  it.each(['createAppointment', 'createAppointmentFast'] as const)(
    'exposes missing inputs as text and clears the error on successful %s',
    async (method) => {
      const { controller } = setup();
      const body = {
        clinic_id: 'clinic-1',
        session_id: 'session-1',
        doctor_id: 'a',
        clinic_service_id: 'general',
        reason_for_visit: 'fever',
        date,
        time: '18:00',
      };
      expect(await controller[method](body, req)).toMatchObject({
        error: 'missing_fields',
        missingFieldsText: 'patient_name, phone',
      });
      expect(
        await controller[method]({ ...body, patient_name: 'Patient', phone: '9876543210' }, req),
      ).toMatchObject({
        status: 'confirmed',
        error: '',
        missingFieldsText: '',
        doctorId: 'a',
      });
    },
  );

  it('does not claim callback submission if no callback record was created', async () => {
    const { controller, callbacks } = setup();
    callbacks.mockResolvedValueOnce([]);
    const body = { clinic_id: 'clinic-1', session_id: 'session-1', phone: '9876543210' };
    expect(await controller.requestCallback(body, req)).toEqual({
      submitted: false,
      error: 'callback_create_failed',
      callbackRequestId: null,
    });
    expect(await controller.requestCallback(body, req)).toEqual({
      submitted: true,
      error: '',
      callbackRequestId: 'callback-1',
    });
  });

  it('returns and clears schedule text so a closed day cannot reuse earlier saved timings', async () => {
    const { controller, schedules } = setup();
    const query = {
      clinic_id: 'clinic-1',
      topic: 'doctor_availability',
      doctor_id: 'a',
      day: date,
    };
    expect(await controller.getClinicInfo(query, req)).toMatchObject({
      error: '',
      found: true,
      available: true,
      timingsText: '9:00 AM - 1:00 PM',
    });
    schedules.mockResolvedValueOnce([]);
    expect(await controller.getClinicInfo(query, req)).toMatchObject({
      error: '',
      found: false,
      available: false,
      timingsText: '',
    });
  });
});
