import { describe, expect, it, vi } from 'vitest';

import { ScheduleChangeImpactService } from '../src/modules/slots/schedule-change-impact.service';

function installPrivateDependency(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value });
}

function createService(input: {
  clinicHours?: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    active: boolean;
  }>;
  doctorSchedules?: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    active: boolean;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  }>;
  appointments?: Array<{
    id: string;
    appointmentStart: string;
    appointmentEnd: string;
    patientName: string;
    doctorName: string | null;
    serviceName: string | null;
    status: string;
  }>;
}) {
  const appointmentLifecycle = {
    listFutureActiveAppointments: vi.fn().mockResolvedValue(input.appointments ?? []),
    listActiveAppointmentsOnDate: vi.fn().mockResolvedValue(input.appointments ?? []),
  };
  const clinicalSetup = {
    listClinicHours: vi.fn().mockResolvedValue(input.clinicHours ?? []),
    listDoctorSchedules: vi.fn().mockResolvedValue(input.doctorSchedules ?? []),
  };
  const service = Object.create(
    ScheduleChangeImpactService.prototype,
  ) as ScheduleChangeImpactService;
  installPrivateDependency(service, 'repos', { appointmentLifecycle, clinicalSetup });
  return { service, appointmentLifecycle };
}

describe('schedule change impact', () => {
  const mondayAppointment = {
    id: 'appointment-1',
    appointmentStart: '2026-09-21 09:30:00',
    appointmentEnd: '2026-09-21 10:00:00',
    patientName: 'Asha Patient',
    doctorName: 'Dr. Test',
    serviceName: 'General consultation',
    status: 'confirmed',
  };
  const mondayAppointmentDetails = {
    patient_name: mondayAppointment.patientName,
    appointment_start: mondayAppointment.appointmentStart,
    appointment_end: mondayAppointment.appointmentEnd,
    doctor_name: mondayAppointment.doctorName,
    service_name: mondayAppointment.serviceName,
    status: mondayAppointment.status,
  };
  const mondayHours = {
    dayOfWeek: 1,
    startTime: '09:00:00',
    endTime: '13:00:00',
    active: true,
  };

  it('accepts an expansion when Postgres returns a space-separated local timestamp', async () => {
    const { service } = createService({
      clinicHours: [mondayHours],
      appointments: [mondayAppointment],
    });

    const result = await service.previewClinicHoursReplace('clinic-1', {
      windows: [
        { day_of_week: 1, start_time: '09:00', end_time: '13:00', active: true },
        { day_of_week: 0, start_time: '09:00', end_time: '13:00', active: true },
        { day_of_week: 6, start_time: '09:00', end_time: '13:00', active: true },
      ],
    });

    expect(result).toEqual({ blocked: false, conflicts: [] });
  });

  it('accepts T-separated local timestamps and ignores pre-existing schedule outliers', async () => {
    const { service } = createService({
      clinicHours: [mondayHours],
      appointments: [
        {
          id: 'existing-outlier',
          appointmentStart: '2026-09-21T14:00:00',
          appointmentEnd: '2026-09-21T14:30:00',
          patientName: 'Existing Outlier',
          doctorName: 'Dr. Test',
          serviceName: 'General consultation',
          status: 'confirmed',
        },
      ],
    });

    const result = await service.previewClinicHoursReplace('clinic-1', {
      windows: [
        { day_of_week: 1, start_time: '09:00', end_time: '13:00', active: true },
        { day_of_week: 6, start_time: '09:00', end_time: '13:00', active: true },
      ],
    });

    expect(result).toEqual({ blocked: false, conflicts: [] });
  });

  it('blocks a contraction that newly excludes any part of an appointment', async () => {
    const { service } = createService({
      clinicHours: [mondayHours],
      appointments: [mondayAppointment],
    });

    const result = await service.previewClinicHoursReplace('clinic-1', {
      windows: [{ day_of_week: 1, start_time: '10:00', end_time: '13:00', active: true }],
    });

    expect(result).toEqual({
      blocked: true,
      conflicts: [
        {
          appointment_id: mondayAppointment.id,
          appointment: mondayAppointmentDetails,
          reason: 'outside_clinic_hours',
        },
      ],
    });
  });

  it('checks the appointment end time, not only its start time', async () => {
    const appointment = {
      id: 'appointment-ending-after-close',
      appointmentStart: '2026-09-21 12:45:00',
      appointmentEnd: '2026-09-21 13:15:00',
      patientName: 'Boundary Patient',
      doctorName: 'Dr. Test',
      serviceName: 'General consultation',
      status: 'confirmed',
    };
    const { service } = createService({
      clinicHours: [
        {
          dayOfWeek: 1,
          startTime: '09:00:00',
          endTime: '14:00:00',
          active: true,
        },
      ],
      appointments: [appointment],
    });

    const result = await service.previewClinicHoursReplace('clinic-1', {
      windows: [{ day_of_week: 1, start_time: '09:00', end_time: '13:00', active: true }],
    });

    expect(result).toEqual({
      blocked: true,
      conflicts: [
        {
          appointment_id: appointment.id,
          appointment: {
            patient_name: appointment.patientName,
            appointment_start: appointment.appointmentStart,
            appointment_end: appointment.appointmentEnd,
            doctor_name: appointment.doctorName,
            service_name: appointment.serviceName,
            status: appointment.status,
          },
          reason: 'outside_clinic_hours',
        },
      ],
    });
  });

  it('treats adjacent windows as continuous coverage', async () => {
    const appointment = {
      id: 'appointment-across-adjacent-windows',
      appointmentStart: '2026-09-21 12:45:00',
      appointmentEnd: '2026-09-21 13:15:00',
      patientName: 'Adjacent Patient',
      doctorName: 'Dr. Test',
      serviceName: 'General consultation',
      status: 'confirmed',
    };
    const { service } = createService({
      clinicHours: [
        {
          dayOfWeek: 1,
          startTime: '09:00:00',
          endTime: '17:00:00',
          active: true,
        },
      ],
      appointments: [appointment],
    });

    const result = await service.previewClinicHoursReplace('clinic-1', {
      windows: [
        { day_of_week: 1, start_time: '09:00', end_time: '13:00', active: true },
        { day_of_week: 1, start_time: '13:00', end_time: '17:00', active: true },
      ],
    });

    expect(result).toEqual({ blocked: false, conflicts: [] });
  });

  it('uses the API day convention of Sunday 0 when checking clinic-local dates', async () => {
    const sundayAppointment = {
      id: 'sunday-appointment',
      appointmentStart: '2026-09-20 09:30:00',
      appointmentEnd: '2026-09-20 10:00:00',
      patientName: 'Sunday Patient',
      doctorName: 'Dr. Sunday',
      serviceName: 'Weekend consultation',
      status: 'pending_confirmation',
    };
    const { service } = createService({
      clinicHours: [
        {
          dayOfWeek: 0,
          startTime: '09:00:00',
          endTime: '13:00:00',
          active: true,
        },
      ],
      appointments: [sundayAppointment],
    });

    const result = await service.previewClinicHoursReplace('clinic-1', { windows: [] });

    expect(result.conflicts).toEqual([
      {
        appointment_id: sundayAppointment.id,
        appointment: {
          patient_name: sundayAppointment.patientName,
          appointment_start: sundayAppointment.appointmentStart,
          appointment_end: sundayAppointment.appointmentEnd,
          doctor_name: sundayAppointment.doctorName,
          service_name: sundayAppointment.serviceName,
          status: sundayAppointment.status,
        },
        reason: 'outside_clinic_hours',
      },
    ]);
  });

  it('blocks a doctor schedule contraction and scopes the lookup to that doctor', async () => {
    const { service, appointmentLifecycle } = createService({
      doctorSchedules: [
        {
          ...mondayHours,
          effectiveFrom: null,
          effectiveTo: null,
        },
      ],
      appointments: [mondayAppointment],
    });

    const result = await service.previewDoctorSchedulesReplace('clinic-1', 'doctor-1', {
      windows: [{ day_of_week: 1, start_time: '10:00', end_time: '13:00', active: true }],
    });

    expect(appointmentLifecycle.listFutureActiveAppointments).toHaveBeenCalledWith(
      'clinic-1',
      'doctor-1',
    );
    expect(result).toEqual({
      blocked: true,
      conflicts: [
        {
          appointment_id: mondayAppointment.id,
          appointment: mondayAppointmentDetails,
          reason: 'outside_doctor_hours',
        },
      ],
    });
  });

  it('allows a doctor schedule expansion that preserves existing coverage', async () => {
    const { service } = createService({
      doctorSchedules: [
        {
          ...mondayHours,
          effectiveFrom: null,
          effectiveTo: null,
        },
      ],
      appointments: [mondayAppointment],
    });

    const result = await service.previewDoctorSchedulesReplace('clinic-1', 'doctor-1', {
      windows: [
        { day_of_week: 1, start_time: '08:00', end_time: '14:00', active: true },
        { day_of_week: 0, start_time: '09:00', end_time: '13:00', active: true },
      ],
    });

    expect(result).toEqual({ blocked: false, conflicts: [] });
  });

  it('includes readable appointment details in holiday conflicts', async () => {
    const { service } = createService({ appointments: [mondayAppointment] });

    const result = await service.previewHolidayDate('clinic-1', '2026-09-21');

    expect(result).toEqual({
      blocked: true,
      conflicts: [
        {
          appointment_id: mondayAppointment.id,
          appointment: mondayAppointmentDetails,
          holiday_date: '2026-09-21',
          reason: 'active_appointment_on_holiday',
        },
      ],
    });
  });
});
