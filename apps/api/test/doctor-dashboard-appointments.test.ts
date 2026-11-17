import { afterEach, describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuthContext } from '@vaidya/shared';

import { AUTH_CONTEXT_KEY } from '../src/common/guards/auth.guard';
import { RbacGuard } from '../src/common/guards/rbac.guard';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import type { AppLogger } from '../src/common/logger/logger.service';
import { AppointmentsController } from '../src/modules/appointment/appointments.controller';
import { AppointmentsService } from '../src/modules/appointment/appointments.service';
import { AppointmentAdminService } from '../src/modules/appointment/appointment-admin.service';
import { AppointmentLifecycleService } from '../src/modules/appointment/appointment-lifecycle.service';

const clinicId = '00000000-0000-0000-0000-000000000001';
const doctorId = '00000000-0000-0000-0000-000000000101';
const userId = '00000000-0000-0000-0000-000000000201';

function setup() {
  const listAppointmentsForClinic = vi.fn().mockResolvedValue([]);
  const markPastConfirmedNoShows = vi.fn().mockResolvedValue(0);
  const listDoctors = vi.fn().mockResolvedValue([{ id: doctorId, name: 'Dr. Merp' }]);
  const listServices = vi
    .fn()
    .mockResolvedValue([{ id: 'service-1', serviceName: 'Consultation' }]);
  const listVisitsByAppointmentIds = vi.fn().mockResolvedValue([]);
  const service = Object.create(AppointmentsService.prototype) as AppointmentsService;
  Object.defineProperty(service, 'repos', {
    value: {
      appointmentLifecycle: { listAppointmentsForClinic, markPastConfirmedNoShows },
      clinical: { listDoctors, listServices },
      patients: { listVisitsByAppointmentIds },
    },
  });
  return {
    service,
    listAppointmentsForClinic,
    markPastConfirmedNoShows,
    listDoctors,
    listServices,
    listVisitsByAppointmentIds,
  };
}

describe('database-backed doctor appointment dashboard', () => {
  it.each(['2024-02-29', '2000-02-29', '2026-11-16'])(
    'preserves the calendar date %s with doctor and status filters',
    async (date) => {
      const { service, listAppointmentsForClinic } = setup();
      await service.listAppointments({
        clinicId,
        doctorId,
        date,
        status: ['confirmed', 'visited'],
      });
      expect(listAppointmentsForClinic).toHaveBeenCalledWith({
        clinicId,
        doctorId,
        date,
        statuses: ['confirmed', 'visited'],
      });
    },
  );

  it.each([
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-11-00',
    '2026-1-6',
    '16/11/2026',
    '0000-01-01',
    '',
    '2026-11-16T09:00:00Z',
  ])('rejects the invalid date %s before any database access', async (date) => {
    const { service, listAppointmentsForClinic, markPastConfirmedNoShows } = setup();
    await expect(service.listAppointments({ clinicId, date })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(markPastConfirmedNoShows).not.toHaveBeenCalled();
    expect(listAppointmentsForClinic).not.toHaveBeenCalled();
  });

  it('keeps the existing unfiltered appointment list contract when date is absent', async () => {
    const { service, listAppointmentsForClinic } = setup();
    await service.listAppointments({ clinicId });
    expect(listAppointmentsForClinic).toHaveBeenCalledWith({ clinicId });
  });

  it('uses canonical patient demographics/history and persisted clinical visit details without per-patient queries', async () => {
    const {
      service,
      listAppointmentsForClinic,
      listDoctors,
      listServices,
      listVisitsByAppointmentIds,
    } = setup();
    const appointment = {
      id: 'appointment-1',
      patientId: 'patient-1',
      patientName: 'Saved patient',
      patientPhone: '9876543210',
      patientAge: 42,
      patientGender: 'Female',
      hasHistory: true,
      doctorId,
      clinicServiceId: 'service-1',
      appointmentStart: '2026-11-16 09:00:00',
      appointmentEnd: '2026-11-16 09:30:00',
      reasonForVisit: 'Saved concern',
      isFollowup: false,
      routingSource: null,
      createdByUserId: null,
      status: 'visited',
      createdAt: new Date('2026-11-10T09:00:00Z'),
    };
    listAppointmentsForClinic.mockResolvedValue([
      appointment,
      {
        ...appointment,
        id: 'appointment-2',
        patientId: null,
        status: 'confirmed',
        patientAge: null,
        patientGender: null,
        hasHistory: false,
      },
    ]);
    listVisitsByAppointmentIds.mockResolvedValue([
      {
        appointmentRequestId: 'appointment-1',
        reasonForVisit: 'Saved visit reason',
        examinationNotes: 'Persisted notes',
        diagnosis: 'Persisted diagnosis',
        advice: 'Persisted advice',
      },
    ]);
    const rows = await service.listAppointments({ clinicId, doctorId, date: '2026-11-16' });
    expect(rows[0]).toMatchObject({
      patient_age: 42,
      patient_gender: 'Female',
      has_history: true,
      examination_notes: 'Persisted notes',
      diagnosis: 'Persisted diagnosis',
      advice: 'Persisted advice',
    });
    expect(rows[1]).toMatchObject({ patient_age: null, patient_gender: null, has_history: false });
    expect(rows[1]).not.toHaveProperty('diagnosis');
    expect(rows[1]).not.toHaveProperty('examination_notes');
    expect(listDoctors).toHaveBeenCalledOnce();
    expect(listServices).toHaveBeenCalledOnce();
    expect(listVisitsByAppointmentIds).toHaveBeenCalledOnce();
    expect(listVisitsByAppointmentIds).toHaveBeenCalledWith(clinicId, ['appointment-1']);
  });
});

describe('doctor appointment date query authorization', () => {
  let app: NestFastifyApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function application(auth: AuthContext) {
    const dependencies = setup();
    const module = await Test.createTestingModule({
      controllers: [AppointmentsController],
      providers: [
        { provide: AppointmentsService, useValue: dependencies.service },
        { provide: AppointmentAdminService, useValue: {} },
        { provide: AppointmentLifecycleService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalGuards(
      {
        canActivate(context) {
          context.switchToHttp().getRequest()[AUTH_CONTEXT_KEY] = auth;
          return true;
        },
      },
      new RbacGuard(new Reflector()),
    );
    app.useGlobalFilters(new AllExceptionsFilter({ error: vi.fn() } as unknown as AppLogger));
    await app.init();
    return { app, ...dependencies };
  }

  it('binds a real GET date query to the authenticated doctor only', async () => {
    const { app: server, listAppointmentsForClinic } = await application({
      userId,
      clinicId,
      clinicRole: 'doctor',
      doctorId,
    });
    const response = await server.inject({
      method: 'GET',
      url: `/clinics/${clinicId}/appointments?date=2026-11-16&status=confirmed,visited&doctor_id=other-doctor`,
    });
    expect(response.statusCode).toBe(200);
    expect(listAppointmentsForClinic).toHaveBeenCalledOnce();
    expect(listAppointmentsForClinic).toHaveBeenCalledWith({
      clinicId,
      doctorId,
      date: '2026-11-16',
      statuses: ['confirmed', 'visited'],
    });
  });

  it('returns a validation response for invalid date queries without touching the database', async () => {
    const { app: server, markPastConfirmedNoShows } = await application({
      userId,
      clinicId,
      clinicRole: 'doctor',
      doctorId,
    });
    const response = await server.inject({
      method: 'GET',
      url: `/clinics/${clinicId}/appointments?date=2026-02-29`,
    });
    expect(response.statusCode).toBe(400);
    expect(markPastConfirmedNoShows).not.toHaveBeenCalled();
  });

  it('rejects an unlinked doctor instead of returning every clinic appointment', async () => {
    const { app: server, listAppointmentsForClinic } = await application({
      userId,
      clinicId,
      clinicRole: 'doctor',
    });
    const response = await server.inject({
      method: 'GET',
      url: `/clinics/${clinicId}/appointments?date=2026-11-16`,
    });
    expect(response.statusCode).toBe(403);
    expect(listAppointmentsForClinic).not.toHaveBeenCalled();
  });

  it('retains the administrator date filter across all doctors', async () => {
    const { app: server, listAppointmentsForClinic } = await application({
      userId,
      clinicId,
      clinicRole: 'clinic_admin',
    });
    expect(
      (
        await server.inject({
          method: 'GET',
          url: `/clinics/${clinicId}/appointments?date=2026-11-16`,
        })
      ).statusCode,
    ).toBe(200);
    expect(listAppointmentsForClinic).toHaveBeenCalledOnce();
    expect(listAppointmentsForClinic).toHaveBeenCalledWith({
      clinicId,
      date: '2026-11-16',
    });
  });
});
