import { describe, expect, it } from 'vitest';
import { computeDoctorDayAvailability } from './doctor-dashboard';

function data(): Parameters<typeof computeDoctorDayAvailability>[0] {
  return {
    date: '2026-11-16',
    doctorId: 'doctor-1',
    schedules: [
      {
        id: 's1',
        doctor_id: 'doctor-1',
        day_of_week: 1,
        start_time: '10:30:00',
        end_time: '14:00:00',
        active: true,
      },
    ],
    clinicHours: [
      { id: 'c1', day_of_week: 1, start_time: '08:00', end_time: '20:00', active: true },
    ],
    holidays: [],
    doctorServices: [
      {
        id: 'm1',
        doctor_id: 'doctor-1',
        clinic_service_id: 'service-1',
        consultation_fee_amount: null,
        active: true,
      },
    ],
    services: [
      {
        id: 'service-1',
        service_name: 'General Consultation',
        service_key: 'general_consultation',
        active: true,
      },
    ],
  };
}

describe('saved doctor hours for the selected clinic date', () => {
  it('uses saved hours and service names without invented shifts or specialties', () => {
    const result = computeDoctorDayAvailability(data());
    expect(result.windows).toEqual([
      { start: '10:30', end: '14:00', label: '10:30 AM – 02:00 PM' },
    ]);
    expect(result.serviceNames).toEqual(['General Consultation']);
    expect(result.message).toBe('Working hours: 10:30 AM – 02:00 PM');
  });

  it('uses the selected calendar weekday and respects inclusive schedule effective dates', () => {
    const input = data();
    input.date = '2026-11-17';
    input.clinicHours.push({ ...input.clinicHours[0]!, id: 'tue-clinic', day_of_week: 2 });
    input.schedules.push(
      {
        ...input.schedules[0]!,
        id: 'tue',
        day_of_week: 2,
        start_time: '16:15',
        end_time: '18:45',
        effective_from: input.date,
        effective_to: input.date,
      },
      { ...input.schedules[0]!, id: 'expired', day_of_week: 2, effective_to: '2026-11-16' },
      { ...input.schedules[0]!, id: 'future', day_of_week: 2, effective_from: '2026-11-18' },
    );
    expect(computeDoctorDayAvailability(input).windows).toEqual([
      { start: '16:15', end: '18:45', label: '04:15 PM – 06:45 PM' },
    ]);
  });

  it('excludes inactive and unrelated doctors, services and service-specific schedules', () => {
    const input = data();
    input.schedules.push(
      {
        ...input.schedules[0]!,
        id: 'other',
        doctor_id: 'doctor-2',
        start_time: '08:00',
        end_time: '10:00',
      },
      { ...input.schedules[0]!, id: 'inactive', active: false },
      {
        ...input.schedules[0]!,
        id: 'wrong-mapping',
        doctor_service_id: 'other-mapping',
        start_time: '15:00',
        end_time: '17:00',
      },
    );
    input.schedules[0]!.doctor_service_id = 'm1';
    expect(computeDoctorDayAvailability(input).windows).toHaveLength(1);
    input.services[0]!.active = false;
    expect(computeDoctorDayAvailability(input)).toMatchObject({
      state: 'not_scheduled',
      windows: [],
      serviceNames: [],
    });
    input.schedules[0]!.doctor_service_id = null;
    expect(computeDoctorDayAvailability(input).windows).toHaveLength(1);
  });

  it('intersects clinic hours, merges overlapping rows and preserves the real lunch break', () => {
    const input = data();
    input.clinicHours = [
      { ...input.clinicHours[0]!, start_time: '10:00', end_time: '12:00' },
      { ...input.clinicHours[0]!, id: 'pm', start_time: '14:00', end_time: '18:00' },
    ];
    input.schedules = [
      { ...input.schedules[0]!, start_time: '09:00', end_time: '16:00' },
      { ...input.schedules[0]!, id: 'overlap', start_time: '15:00', end_time: '19:00' },
    ];
    expect(
      computeDoctorDayAvailability(input).windows.map(({ start, end }) => [start, end]),
    ).toEqual([
      ['10:00', '12:00'],
      ['14:00', '18:00'],
    ]);
  });

  it.each([[], ['doctor-1'], ['doctor-1', 'doctor-2']].map((doctorIds) => ({ doctorIds })))(
    'respects full-day holidays applying to $doctorIds',
    ({ doctorIds }) => {
      const input = data();
      input.holidays.push({
        id: 'h1',
        holiday_date: input.date,
        active: true,
        is_full_day: true,
        reason: 'Clinic leave',
        applies_to_clinic: doctorIds.length === 0,
        doctor_ids: doctorIds,
      });
      expect(computeDoctorDayAvailability(input)).toMatchObject({
        state: 'holiday',
        windows: [],
        message: 'Holiday: Clinic leave',
      });
    },
  );

  it('ignores inactive, unrelated and different-date holidays', () => {
    const input = data();
    const holiday = {
      id: 'h1',
      holiday_date: input.date,
      active: true,
      is_full_day: true,
      reason: null,
      applies_to_clinic: false,
      doctor_ids: ['doctor-2'],
    };
    input.holidays = [
      holiday,
      { ...holiday, id: 'inactive', doctor_ids: ['doctor-1'], active: false },
      { ...holiday, id: 'other-day', doctor_ids: ['doctor-1'], holiday_date: '2026-11-17' },
    ];
    expect(computeDoctorDayAvailability(input).state).toBe('scheduled');
  });

  it('subtracts partial closures and leaves boundary-touching working hours intact', () => {
    const input = data();
    const holiday = {
      id: 'h1',
      holiday_date: input.date,
      active: true,
      is_full_day: false,
      reason: 'Meeting',
      applies_to_clinic: false,
      doctor_ids: ['doctor-1'],
      start_time: '11:30',
      end_time: '12:00',
    };
    input.holidays = [
      holiday,
      { ...holiday, id: 'overlap', start_time: '11:45', end_time: '12:30' },
      { ...holiday, id: 'touching', start_time: '14:00', end_time: '15:00' },
    ];
    expect(
      computeDoctorDayAvailability(input).windows.map(({ start, end }) => [start, end]),
    ).toEqual([
      ['10:30', '11:30'],
      ['12:30', '14:00'],
    ]);
    input.holidays = [{ ...holiday, start_time: '10:00', end_time: '15:00' }];
    expect(computeDoctorDayAvailability(input)).toMatchObject({ state: 'holiday', windows: [] });
  });

  it('distinguishes closed clinics, unscheduled doctors and invalid dates without fake fallback hours', () => {
    const input = data();
    expect(computeDoctorDayAvailability({ ...input, clinicHours: [] })).toMatchObject({
      state: 'closed',
      windows: [],
    });
    expect(computeDoctorDayAvailability({ ...input, schedules: [] })).toMatchObject({
      state: 'not_scheduled',
      windows: [],
    });
    expect(computeDoctorDayAvailability({ ...input, date: '2026-02-30' })).toMatchObject({
      state: 'not_scheduled',
      windows: [],
    });
  });
});
