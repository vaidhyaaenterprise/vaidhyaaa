import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { SarvamToolsController } from '../src/modules/sarvam-tools/sarvam-tools.controller';
import {
  chooseAvailability,
  availabilityWindow,
} from '../src/modules/sarvam-tools/sarvam-availability';

const date = '2026-11-02';
const nextDate = '2026-11-03';
const req = { headers: {} } as FastifyRequest;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T06:00:00Z'));
});
afterEach(() => vi.useRealTimers());

function slot(time: string, day = date, capacity = 1) {
  return {
    slot_id: `${day}-${time}`,
    start_time: `${day} ${time}:00`,
    end_time: `${day} ${time}:00`,
    available_count: capacity,
  };
}
const doctors = [
  { doctorId: 'a', doctorName: 'Dr. Arun', qualification: 'MBBS', clinicServiceId: 'general' },
  { doctorId: 'b', doctorName: 'Dr. Bala', qualification: 'MD', clinicServiceId: 'general' },
];
function setup(rows: Record<string, ReturnType<typeof slot>[]>) {
  const controller = Object.create(SarvamToolsController.prototype) as SarvamToolsController;
  const findAvailableSlots = vi.fn(
    async (_clinic: string, doctor: string, _service: string, day?: string) =>
      (rows[doctor] ?? []).filter((row) => !day || row.start_time.startsWith(day)),
  );
  const repos = {
    patients: { upsertByPhone: vi.fn().mockResolvedValue([{ id: 'patient-1' }]) },
    clinics: { getClinicLocation: vi.fn().mockResolvedValue([{ timezone: 'Asia/Kolkata' }]) },
    clinical: {
      listServices: vi.fn().mockResolvedValue([
        {
          id: 'general',
          active: true,
          serviceName: 'General Consultation',
          serviceKey: 'general',
          handlesJson: ['fever'],
          routingExamplesJson: ['cough'],
        },
        { id: 'skin', active: true, serviceName: 'Skin Consultation', serviceKey: 'skin' },
      ]),
      listActiveDoctorServices: vi.fn().mockResolvedValue(doctors),
    },
  };
  const route = vi.fn().mockResolvedValue({ matched: true, clinicServiceId: 'general' });
  const createAppointmentFromFreshHold = vi.fn().mockResolvedValue({
    appointment: { id: 'appointment-1', status: 'confirmed' },
    hold: { id: 'hold-1' },
  });
  Object.defineProperties(controller, {
    repos: { value: repos },
    serviceRouter: { value: { route } },
    slotService: { value: { findAvailableSlots } },
    bookingAppointmentService: { value: { createAppointmentFromFreshHold } },
  });
  const check = (query: Record<string, string | undefined> = {}) =>
    controller.checkSlots({ clinic_id: 'clinic-1', service_key: 'general', date, ...query }, req);
  return { controller, check, findAvailableSlots, repos, route, createAppointmentFromFreshHold };
}

describe('Sarvam availability across service doctors', () => {
  it('provides service mapping metadata and defers random selection until availability is known', async () => {
    const { controller, route } = setup({});
    expect(await controller.listServices({ clinic_id: 'clinic-1' }, req)).toMatchObject({
      services: expect.arrayContaining([
        expect.objectContaining({
          serviceKey: 'general',
          handles: ['fever'],
          routingExamples: ['cough'],
        }),
      ]),
      serviceRoutingText: expect.stringContaining('service_key=general'),
    });
    expect(
      await controller.recommendService({ clinic_id: 'clinic-1', service_key: 'general' }, req),
    ).toMatchObject({
      matched: true,
      doctorId: null,
      doctorName: null,
      doctorSelection: 'pending_availability',
      clinicServiceId: 'general',
      doctors: expect.arrayContaining([
        expect.objectContaining({ doctorId: 'a' }),
        expect.objectContaining({ doctorId: 'b' }),
      ]),
    });
    expect(route).not.toHaveBeenCalled();
  });

  it('checks every eligible doctor and chooses only one with matching preference', async () => {
    const { check, findAvailableSlots } = setup({
      a: [slot('09:00')],
      b: [slot('18:00'), slot('18:30')],
    });
    expect(await check({ time_preference: 'evening' })).toMatchObject({
      success: true,
      availabilityStatus: 'matched',
      matchesPreference: true,
      doctorId: 'b',
      doctorSelection: 'random',
      availableSlotsText: '18:00, 18:30',
    });
    expect(findAvailableSlots).toHaveBeenCalledTimes(2);
    expect(findAvailableSlots).toHaveBeenCalledWith('clinic-1', 'a', 'general', date);
    expect(findAvailableSlots).toHaveBeenCalledWith('clinic-1', 'b', 'general', date);
  });

  it.each([{ doctor_id: 'a' }, { doctor_name: 'Arun' }])(
    'keeps the requested doctor fixed for matches and same-day fallback: %j',
    async (preference) => {
      const { check, findAvailableSlots } = setup({ a: [slot('09:00')], b: [slot('18:00')] });
      expect(await check({ ...preference, time_preference: 'evening' })).toMatchObject({
        doctorId: 'a',
        doctorSelection: 'requested',
        availabilityStatus: 'same_day_alternative',
        matchesPreference: false,
        availableSlotsText: '09:00',
        date,
      });
      expect(findAvailableSlots).toHaveBeenCalledTimes(1);
      expect(findAvailableSlots).toHaveBeenCalledWith('clinic-1', 'a', 'general', date);
    },
  );

  it('does not search other doctors or other days when the requested doctor has no same-day slots', async () => {
    const { check, findAvailableSlots } = setup({
      a: [slot('18:00', nextDate)],
      b: [slot('18:00')],
    });
    expect(await check({ doctor_id: 'a', after_time: '17:00' })).toMatchObject({
      success: true,
      availabilityStatus: 'no_slots',
      hasAvailability: false,
      suggestAnotherDate: true,
      doctorId: 'a',
      date,
      availableSlotsText: 'no slots',
    });
    expect(findAvailableSlots.mock.calls).toEqual([['clinic-1', 'a', 'general', date]]);
  });

  it('offers the nearest same-day alternative across the eligible pool without querying another date', async () => {
    const { check, findAvailableSlots } = setup({
      a: [slot('09:00'), slot('18:00', nextDate)],
      b: [slot('16:45')],
    });
    expect(await check({ after_time: '18:00' })).toMatchObject({
      availabilityStatus: 'same_day_alternative',
      doctorId: 'b',
      date,
      availableSlotsText: '16:45',
    });
    expect(findAvailableSlots.mock.calls.every((call) => call[3] === date)).toBe(true);
  });

  it('selects the doctor available at the exact time chosen from an overview', async () => {
    const { check } = setup({ a: [slot('09:00')], b: [slot('13:30')] });
    expect(await check({ time: '13:30' })).toMatchObject({
      availabilityStatus: 'matched',
      doctorId: 'b',
      availableSlotsText: '13:30',
    });
  });

  it('keeps the chosen time and doctor paired when several doctors qualify', async () => {
    const rows = [
      { doctor: doctors[0]!, rows: [slot('18:00')] },
      { doctor: doctors[1]!, rows: [slot('18:30')] },
    ];
    const pick = vi.fn((count: number) => count - 1);
    const result = chooseAvailability(
      rows,
      date,
      availabilityWindow('evening', null, null, null),
      false,
      3,
      pick,
    );
    expect(pick).toHaveBeenCalledWith(2);
    expect(result).toMatchObject({
      doctor: { doctorId: 'b' },
      times: ['18:30'],
      status: 'matched',
    });
    const tied = chooseAvailability(
      rows.map((row) => ({ ...row, rows: [slot('18:00')] })),
      date,
      availabilityWindow(null, null, null, '18:00'),
      false,
      3,
      () => 0,
    );
    expect(tied).toMatchObject({ doctor: { doctorId: 'a' }, times: ['18:00'] });
  });

  it('books the accepted random offer without selecting a different doctor during booking', async () => {
    const { controller, check, createAppointmentFromFreshHold } = setup({
      a: [slot('09:00')],
      b: [slot('18:00')],
    });
    const offer = await check({ time_preference: 'evening' });
    expect(offer).toMatchObject({ doctorId: 'b', availableSlotsText: '18:00' });
    const booking = await controller.createAppointment(
      {
        clinic_id: 'clinic-1',
        session_id: 'session-1',
        patient_name: 'Patient',
        phone: '9876543210',
        reason_for_visit: 'fever',
        clinic_service_id: 'general',
        doctor_id: 'b',
        date,
        time: '18:00',
      },
      req,
    );
    expect(booking).toMatchObject({ status: 'confirmed', doctorId: 'b', doctorName: 'Dr. Bala' });
    expect(createAppointmentFromFreshHold).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDoctorId: 'b',
        expectedClinicServiceId: 'general',
        slotId: `${date}-18:00`,
      }),
    );
  });

  it('requires an accepted doctor before booking rather than randomly assigning one during the write', async () => {
    const { controller, repos, createAppointmentFromFreshHold } = setup({});
    expect(
      await controller.createAppointment(
        {
          clinic_id: 'clinic-1',
          session_id: 'session-1',
          patient_name: 'Patient',
          phone: '9876543210',
          reason_for_visit: 'fever',
          clinic_service_id: 'general',
          date,
          time: '18:00',
        },
        req,
      ),
    ).toEqual({ error: 'doctor_required', needsClarification: true });
    expect(repos.patients.upsertByPhone).not.toHaveBeenCalled();
    expect(createAppointmentFromFreshHold).not.toHaveBeenCalled();
  });

  it('excludes rejected random doctors and asks for another date if all others have no slots', async () => {
    const { check, findAvailableSlots } = setup({
      a: [slot('09:00')],
      b: [slot('18:00', nextDate)],
    });
    expect(await check({ exclude_doctor_ids: 'a' })).toMatchObject({
      availabilityStatus: 'no_slots',
      suggestAnotherDate: true,
      doctorId: null,
    });
    expect(findAvailableSlots.mock.calls).toEqual([['clinic-1', 'b', 'general', date]]);
    findAvailableSlots.mockClear();
    expect(await check({ exclude_doctor_ids: 'a,b' })).toMatchObject({
      availabilityStatus: 'no_slots',
    });
    expect(findAvailableSlots).not.toHaveBeenCalled();
    expect(await check({ doctor_id: 'a', exclude_doctor_ids: 'a' })).toEqual({
      success: false,
      error: 'doctor_excluded',
      needsClarification: true,
    });
  });

  it('offers another eligible doctor on the same day after rejection', async () => {
    const { check } = setup({ a: [slot('09:00')], b: [slot('10:00')] });
    expect(await check({ exclude_doctor_ids: 'a' })).toMatchObject({
      doctorId: 'b',
      availableSlotsText: '10:00',
    });
  });

  it('lists real dates and times by doctor only in explicit overview mode', async () => {
    const { check, findAvailableSlots } = setup({
      a: [
        slot('09:00'),
        slot('10:00', nextDate),
        slot('12:00', date, 0),
        slot('15:00', '2027-01-01'),
      ],
      b: [slot('18:00', nextDate)],
    });
    const result = await check({ mode: 'overview', date: undefined });
    expect(result).toMatchObject({
      success: true,
      availabilityStatus: 'overview',
      hasAvailability: true,
      doctorId: null,
      availableSlotsText: '',
      availableDatesText: `${date}, ${nextDate}`,
      doctorAvailability: [
        {
          doctorId: 'a',
          availableDatesText: `${date}, ${nextDate}`,
          availabilityText: `${date}: 09:00; ${nextDate}: 10:00`,
        },
        { doctorId: 'b', availableDatesText: nextDate, availabilityText: `${nextDate}: 18:00` },
      ],
    });
    expect(result).not.toHaveProperty('slots');
    expect(findAvailableSlots).toHaveBeenCalledTimes(2);
    expect(findAvailableSlots.mock.calls.every((call) => call[3] === undefined)).toBe(true);
  });

  it('limits an overview to the requested doctor and explicit date range', async () => {
    const { check, findAvailableSlots } = setup({
      a: [slot('09:00'), slot('10:00', nextDate)],
      b: [slot('18:00')],
    });
    expect(
      await check({
        mode: 'overview',
        date: undefined,
        doctor_id: 'a',
        from_date: nextDate,
        to_date: nextDate,
      }),
    ).toMatchObject({
      availableDatesText: nextDate,
      doctorAvailability: [{ doctorId: 'a', availabilityText: `${nextDate}: 10:00` }],
    });
    expect(findAvailableSlots).toHaveBeenCalledTimes(1);
    expect(await check({ mode: 'overview', doctor_id: 'a' })).toMatchObject({
      availableDatesText: date,
      doctorAvailability: [{ doctorId: 'a', availabilityText: `${date}: 09:00` }],
    });
  });

  it('rejects ambiguous names within the selected service before checking availability', async () => {
    const { controller, repos, findAvailableSlots } = setup({});
    repos.clinical.listActiveDoctorServices.mockResolvedValue([
      { ...doctors[0]!, doctorName: 'Dr. Ravi' },
      { ...doctors[1]!, doctorName: 'Dr. Ravi' },
    ]);
    expect(
      await controller.recommendService(
        { clinic_id: 'clinic-1', service_key: 'general', doctor_name: 'Ravi' },
        req,
      ),
    ).toMatchObject({
      matched: false,
      error: 'doctor_ambiguous',
      doctors: [{ doctorId: 'a' }, { doctorId: 'b' }],
    });
    expect(findAvailableSlots).not.toHaveBeenCalled();
  });

  it('matches a doctor within the selected service before preferring a short exact name elsewhere', async () => {
    const { controller, repos } = setup({});
    repos.clinical.listActiveDoctorServices.mockResolvedValue([
      { ...doctors[0]!, doctorName: 'Dr. Ravi Kumar' },
      { ...doctors[1]!, doctorName: 'Dr. Ravi', clinicServiceId: 'skin' },
    ]);
    expect(
      await controller.recommendService(
        {
          clinic_id: 'clinic-1',
          service_key: 'general',
          doctor_name: 'Ravi',
        },
        req,
      ),
    ).toMatchObject({ matched: true, doctorId: 'a', clinicServiceId: 'general' });
  });

  it.each([
    [{ mode: 'invalid' }, 'invalid_mode'],
    [{ date: '2026-11-31' }, 'invalid_date'],
    [{ date: '2026-10-31' }, 'past_date'],
    [{ date: '2027-01-01' }, 'outside_booking_horizon'],
    [{ date: undefined }, 'date_required'],
    [{ from_date: date }, 'invalid_date_range'],
    [{ time: '24:00' }, 'invalid_time'],
    [{ time_preference: 'night' }, 'invalid_time_preference'],
    [{ time_preference: 'evening', before_time: '12:00' }, 'invalid_time_range'],
    [{ mode: 'overview', time_preference: 'evening' }, 'overview_requires_no_time_filters'],
    [
      { mode: 'overview', date: undefined, from_date: nextDate, to_date: date },
      'invalid_date_range',
    ],
  ])('rejects invalid search inputs %j', async (query, error) => {
    const { check, findAvailableSlots } = setup({});
    expect(await check(query)).toEqual({ success: false, error });
    expect(findAvailableSlots).not.toHaveBeenCalled();
  });

  it('does not report no slots when a doctor lookup actually failed', async () => {
    const { check, findAvailableSlots } = setup({ a: [slot('09:00')] });
    findAvailableSlots.mockRejectedValueOnce(new Error('slot update pending'));
    await expect(check()).rejects.toThrow('slot update pending');
  });
});
