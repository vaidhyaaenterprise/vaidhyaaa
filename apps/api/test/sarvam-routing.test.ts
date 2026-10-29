import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { SarvamToolsController } from '../src/modules/sarvam-tools/sarvam-tools.controller';
import { normalizeDoctorName } from '../src/modules/sarvam-tools/sarvam-routing';
import { SlotHoldService } from '../src/modules/slots/slot-hold.service';
import { BookingAppointmentService } from '../src/modules/booking/booking-appointment.service';

const req = { headers: {} } as FastifyRequest;
const clinicId = 'clinic-1';
const date = '2026-11-02';
const services = [
  {
    id: 'general',
    serviceKey: 'general_consultation',
    serviceName: 'General Consultation',
    active: true,
  },
  { id: 'skin', serviceKey: 'skin_consultation', serviceName: 'Skin Consultation', active: true },
  { id: 'inactive', serviceKey: 'old_service', serviceName: 'Old Service', active: false },
];
const mappings = [
  { doctorId: 'zed', doctorName: 'Dr. Zed', clinicServiceId: 'general', qualification: 'MD' },
  { doctorId: 'arun', doctorName: 'Dr. Arun', clinicServiceId: 'general', qualification: 'MBBS' },
  {
    doctorId: 'ravi-general',
    doctorName: 'Dr. Ravi',
    clinicServiceId: 'general',
    qualification: 'MBBS',
  },
  {
    doctorId: 'ravi-skin',
    doctorName: 'Dr. Ravi',
    clinicServiceId: 'skin',
    qualification: 'MD Dermatology',
  },
];
function dependency(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, configurable: true });
}
function setup(extraMappings: typeof mappings = []) {
  const controller = Object.create(SarvamToolsController.prototype) as SarvamToolsController;
  const route = vi
    .fn()
    .mockImplementation(async ({ reasonForVisit }: { reasonForVisit: string }) => ({
      matched: true,
      clinicServiceId: reasonForVisit.includes('skin') ? 'skin' : 'general',
    }));
  const findAvailableSlots = vi
    .fn()
    .mockImplementation(async (_clinic: string, doctor: string, service: string) => [
      {
        slot_id: `${doctor}-${service}-slot`,
        start_time: `${date} 09:00:00`,
        end_time: `${date} 09:30:00`,
        available_count: 1,
      },
    ]);
  const createAppointmentFromFreshHold = vi.fn().mockResolvedValue({
    appointment: { id: 'appointment-1', status: 'confirmed' },
    hold: { id: 'hold-1' },
  });
  const repos = {
    clinical: {
      listServices: vi.fn().mockResolvedValue(services),
      listActiveDoctorServices: vi.fn().mockResolvedValue([...mappings, ...extraMappings]),
    },
    clinics: { getClinicLocation: vi.fn().mockResolvedValue([{ timezone: 'Asia/Kolkata' }]) },
    patients: { upsertByPhone: vi.fn().mockResolvedValue([{ id: 'patient-1' }]) },
  };
  dependency(controller, 'repos', repos);
  dependency(controller, 'serviceRouter', { route });
  dependency(controller, 'slotService', { findAvailableSlots });
  dependency(controller, 'bookingAppointmentService', { createAppointmentFromFreshHold });
  const recommend = (query: Record<string, string>) =>
    controller.recommendService({ clinic_id: clinicId, ...query }, req);
  const check = (query: Record<string, string>) =>
    controller.checkSlots({ clinic_id: clinicId, date, ...query }, req);
  return {
    controller,
    recommend,
    check,
    route,
    findAvailableSlots,
    createAppointmentFromFreshHold,
    repos,
  };
}

describe('Sarvam service and doctor routing', () => {
  it('lists all active services and every associated doctor rather than one default doctor', async () => {
    const { controller, repos } = setup();
    const result = await controller.listServices({ clinic_id: clinicId }, req);
    expect(result).toMatchObject({
      found: true,
      serviceNames: ['General Consultation', 'Skin Consultation'],
      servicesText: 'General Consultation, Skin Consultation',
      services: [
        {
          name: 'General Consultation',
          doctors: [{ doctorId: 'arun' }, { doctorId: 'ravi-general' }, { doctorId: 'zed' }],
        },
        { name: 'Skin Consultation', doctors: [{ doctorId: 'ravi-skin' }] },
      ],
    });
    expect(repos.clinical.listActiveDoctorServices).toHaveBeenCalledWith(clinicId);
    expect(
      await controller.getClinicInfo({ clinic_id: clinicId, topic: 'services' }, req),
    ).toMatchObject(result);
  });

  it('honours a named non-default doctor and keeps all service doctors in the result', async () => {
    const { recommend, check, findAvailableSlots } = setup();
    expect(
      await recommend({ service_key: 'general_consultation', doctor_name: 'doctor zed' }),
    ).toMatchObject({
      matched: true,
      doctorId: 'zed',
      clinicServiceId: 'general',
      doctorSelection: 'requested',
      doctors: expect.arrayContaining([
        { doctorId: 'arun', doctorName: 'Dr. Arun', qualification: 'MBBS' },
      ]),
    });
    const response = await check({ clinic_service_id: 'general', doctor_name: 'Dr.ZED' });
    expect(response).toMatchObject({
      success: true,
      doctorId: 'zed',
      slots: [
        { slotId: 'zed-general-slot', doctorId: 'zed', clinicServiceId: 'general', time: '09:00' },
      ],
    });
    expect(findAvailableSlots).toHaveBeenCalledWith(clinicId, 'zed', 'general', date);
  });

  it('resolves a unique doctor name before asking for a concern', async () => {
    expect(await setup().recommend({ doctor_name: 'Arun' })).toMatchObject({
      matched: true,
      doctorId: 'arun',
      clinicServiceId: 'general',
    });
  });

  it('requires service/issue clarification for two same-named doctors and clears selected IDs', async () => {
    const { recommend } = setup();
    expect(await recommend({ doctor_name: 'ravi' })).toMatchObject({
      matched: false,
      error: 'doctor_ambiguous',
      needsClarification: true,
      doctorId: null,
      clinicServiceId: null,
      services: [{ clinicServiceId: 'general' }, { clinicServiceId: 'skin' }],
      doctors: expect.arrayContaining([
        expect.objectContaining({ doctorId: 'ravi-general' }),
        expect.objectContaining({ doctorId: 'ravi-skin' }),
      ]),
    });
    expect(
      await recommend({ doctor_name: 'Ravi', reason_for_visit: 'skin itching' }),
    ).toMatchObject({
      matched: true,
      doctorId: 'ravi-skin',
      clinicServiceId: 'skin',
    });
    expect(await recommend({ doctor_name: 'Ravi', clinic_service_id: 'general' })).toMatchObject({
      matched: true,
      doctorId: 'ravi-general',
      clinicServiceId: 'general',
    });
  });

  it('does not guess when same-name doctors also share the same service', async () => {
    const { recommend, check, findAvailableSlots } = setup([
      {
        doctorId: 'ravi-other',
        doctorName: 'Dr. Ravi',
        clinicServiceId: 'skin',
        qualification: 'MBBS',
      },
    ]);
    expect(await recommend({ doctor_name: 'Ravi', clinic_service_id: 'skin' })).toMatchObject({
      matched: false,
      error: 'doctor_ambiguous',
      needsClarification: true,
    });
    expect(await check({ doctor_name: 'Ravi', clinic_service_id: 'skin' })).toMatchObject({
      success: false,
      error: 'doctor_ambiguous',
    });
    expect(findAvailableSlots).not.toHaveBeenCalled();
    expect(await recommend({ doctor_id: 'ravi-other', clinic_service_id: 'skin' })).toMatchObject({
      matched: true,
      doctorId: 'ravi-other',
    });
  });

  it('asks which service when one named doctor provides several services', async () => {
    const { recommend } = setup([
      { doctorId: 'arun', doctorName: 'Dr. Arun', clinicServiceId: 'skin', qualification: 'MBBS' },
    ]);
    expect(await recommend({ doctor_name: 'Arun' })).toMatchObject({
      matched: false,
      error: 'service_required_for_doctor',
      needsClarification: true,
    });
    expect(
      await recommend({ doctor_name: 'Arun', reason_for_visit: 'skin itching' }),
    ).toMatchObject({
      matched: true,
      doctorId: 'arun',
      clinicServiceId: 'skin',
    });
  });

  it('routes a changed concern afresh and fetches slots for the newly selected doctor', async () => {
    const { recommend, check, route, findAvailableSlots } = setup();
    expect(await recommend({ reason_for_visit: 'fever' })).toMatchObject({
      doctorId: 'arun',
      clinicServiceId: 'general',
    });
    await check({ doctor_id: 'arun', clinic_service_id: 'general' });
    expect(await recommend({ reason_for_visit: 'skin rash' })).toMatchObject({
      doctorId: 'ravi-skin',
      clinicServiceId: 'skin',
    });
    await check({ doctor_id: 'ravi-skin', clinic_service_id: 'skin' });
    expect(findAvailableSlots).toHaveBeenLastCalledWith(clinicId, 'ravi-skin', 'skin', date);
    expect(route).toHaveBeenLastCalledWith(
      expect.objectContaining({ reasonForVisit: 'skin rash' }),
    );
  });

  it('rejects an incompatible old doctor/service pair rather than reverting to the old service', async () => {
    const { recommend, check, findAvailableSlots } = setup();
    expect(await recommend({ doctor_name: 'Arun', reason_for_visit: 'skin rash' })).toMatchObject({
      matched: false,
      error: 'doctor_service_mismatch',
      doctorId: null,
      clinicServiceId: null,
    });
    expect(await check({ doctor_id: 'arun', clinic_service_id: 'skin' })).toMatchObject({
      success: false,
      error: 'doctor_service_mismatch',
    });
    expect(findAvailableSlots).not.toHaveBeenCalled();
  });

  it('rejects stale IDs that contradict a newly requested name or service key', async () => {
    const { recommend } = setup();
    expect(await recommend({ doctor_id: 'arun', doctor_name: 'Zed' })).toMatchObject({
      matched: false,
      error: 'doctor_name_id_mismatch',
    });
    expect(
      await recommend({ clinic_service_id: 'general', service_key: 'skin_consultation' }),
    ).toMatchObject({
      matched: false,
      error: 'service_id_key_mismatch',
    });
  });

  it('does not treat a failed routing decision as a successful old selection', async () => {
    const { recommend, route } = setup();
    route.mockResolvedValueOnce({ matched: false });
    expect(await recommend({ reason_for_visit: 'unclear concern' })).toMatchObject({
      matched: false,
      error: 'service_not_found',
      doctorId: null,
      clinicServiceId: null,
    });
    expect(await recommend({ doctor_name: 'Unknown' })).toMatchObject({
      matched: false,
      error: 'doctor_not_found',
    });
    expect(normalizeDoctorName('Dr.RAVI')).toBe('ravi');
    expect(normalizeDoctorName('Drake')).toBe('drake');
  });

  it.each(['createAppointment', 'createAppointmentFast'] as const)(
    'validates doctor/service for %s before writing',
    async (method) => {
      const { controller, repos, createAppointmentFromFreshHold } = setup();
      const body = {
        clinic_id: clinicId,
        session_id: 'session-1',
        patient_name: 'Patient',
        phone: '9876543210',
        doctor_id: 'arun',
        clinic_service_id: 'skin',
        reason_for_visit: 'skin rash',
        date,
        slot_id: 'old-slot',
      };
      expect(await controller[method](body, req)).toMatchObject({
        error: 'doctor_service_mismatch',
      });
      expect(repos.patients.upsertByPhone).not.toHaveBeenCalled();
      expect(createAppointmentFromFreshHold).not.toHaveBeenCalled();
      expect(
        await controller[method]({ ...body, doctor_id: 'zed', clinic_service_id: 'general' }, req),
      ).toMatchObject({ status: 'confirmed', doctorId: 'zed', doctorName: 'Dr. Zed' });
      expect(createAppointmentFromFreshHold).toHaveBeenLastCalledWith(
        expect.objectContaining({
          expectedDoctorId: 'zed',
          expectedClinicServiceId: 'general',
        }),
      );
    },
  );
});

describe('Booking slot service guard', () => {
  it('rejects a stale same-doctor slot from a different service under the slot lock', async () => {
    const holds = Object.create(SlotHoldService.prototype) as SlotHoldService;
    dependency(holds, 'dbService', {
      withSlotForUpdate: async (
        _clinic: string,
        _slot: string,
        mutate: (slot: unknown, tx: unknown) => Promise<unknown>,
      ) => mutate({ status: 'open', doctorId: 'arun', clinicServiceId: 'general' }, {}),
    });
    await expect(
      holds.holdSlotAndCreateAppointment({
        clinicId,
        slotId: 'old-general-slot',
        patientName: 'Patient',
        reasonForVisit: 'skin',
        expectedDoctorId: 'arun',
        expectedClinicServiceId: 'skin',
      }),
    ).rejects.toMatchObject({
      code: 'SLOT_NOT_AVAILABLE',
      message: 'Slot does not belong to the selected service.',
    });
  });

  it('forwards the expected service from booking to the atomic hold operation', async () => {
    const booking = Object.create(BookingAppointmentService.prototype) as BookingAppointmentService;
    const hold = vi.fn().mockRejectedValue(new Error('sentinel stop before write'));
    dependency(booking, 'slotHoldService', { holdSlotAndCreateAppointment: hold });
    await expect(
      booking.createAppointmentFromFreshHold({
        clinicId,
        slotId: 'slot',
        patientName: 'Patient',
        reasonForVisit: 'skin',
        expectedDoctorId: 'arun',
        expectedClinicServiceId: 'skin',
      }),
    ).rejects.toThrow('sentinel');
    expect(hold).toHaveBeenCalledWith(expect.objectContaining({ expectedClinicServiceId: 'skin' }));
  });
});
