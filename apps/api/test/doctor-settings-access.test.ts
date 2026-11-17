import { afterEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type AuthContext } from '@vaidya/shared';

import { AUTH_CONTEXT_KEY } from '../src/common/guards/auth.guard';
import { RbacGuard } from '../src/common/guards/rbac.guard';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import type { AppLogger } from '../src/common/logger/logger.service';
import { ClinicClinicalController } from '../src/modules/clinic-setup/clinic-clinical.controller';
import { ClinicClinicalService } from '../src/modules/clinic-setup/clinic-clinical.service';
import { DoctorHistoryService } from '../src/modules/clinic-setup/doctor-history.service';

const clinicId = '00000000-0000-0000-0000-000000000001';
const doctorId = '00000000-0000-0000-0000-000000000101';
const otherDoctorId = '00000000-0000-0000-0000-000000000102';
const actorId = '00000000-0000-0000-0000-000000000201';
const now = new Date('2026-11-16T12:00:00Z');
const holiday = {
  id: 'holiday-1',
  clinicId,
  holidayDate: '2026-11-23',
  isFullDay: true,
  startTime: null,
  endTime: null,
  reason: 'Leave',
  active: true,
  createdByUserId: actorId,
  createdAt: now,
  updatedAt: now,
};
const rule = {
  id: 'rule-1',
  clinicId,
  doctorId,
  clinicServiceId: 'service-1',
  slotDurationMinutes: 15,
  capacityPerSlot: 3,
  bookingHorizonDays: 45,
  minBookingNoticeMinutes: 0,
  maxAdvanceBookingDays: null,
  effectiveFrom: '2026-11-01',
  effectiveTo: null,
  active: true,
  version: 1,
  createdAt: now,
  updatedAt: now,
};
const conflicts = [
  {
    reason: 'active_appointment_on_holiday',
    appointment: {
      id: 'appointment-1',
      patient_name: 'Rajan',
      doctor_name: 'Dr. Merp',
      appointment_start: '2026-11-23 09:00:00',
      appointment_end: '2026-11-23 09:15:00',
    },
  },
];

function dependency(target: object, name: string, value: unknown) {
  Object.defineProperty(target, name, { value });
}

function setupService() {
  const service = Object.create(ClinicClinicalService.prototype) as ClinicClinicalService;
  const clinicalSetup = {
    listDoctors: vi.fn().mockResolvedValue([{ id: doctorId }, { id: otherDoctorId }]),
    listHolidays: vi.fn().mockResolvedValue([holiday]),
    listHolidayDoctorMappings: vi.fn().mockResolvedValue([{ holidayId: holiday.id, doctorId }]),
    findHoliday: vi.fn().mockResolvedValue([holiday]),
    listHolidayDoctors: vi.fn().mockResolvedValue([{ doctorId }]),
    insertHoliday: vi.fn().mockResolvedValue([holiday]),
    patchHoliday: vi.fn().mockResolvedValue([holiday]),
    replaceHolidayDoctors: vi.fn().mockResolvedValue([]),
    listDoctorServiceMappings: vi.fn().mockResolvedValue([]),
    replaceDoctorSchedules: vi.fn().mockResolvedValue([]),
  };
  const repos = { clinicalSetup, slots: { findBookingRule: vi.fn().mockResolvedValue([rule]) } };
  const impact = {
    previewHolidayDate: vi.fn().mockResolvedValue({ blocked: false, conflicts: [] }),
    previewBookingRuleChange: vi.fn().mockResolvedValue({ blocked: false, conflicts: [] }),
    applyBookingRuleUpdate: vi.fn().mockResolvedValue({ ...rule, slotDurationMinutes: 30 }),
    previewDoctorSchedulesReplace: vi.fn().mockResolvedValue({ blocked: false, conflicts: [] }),
  };
  const save = vi.fn(
    async (_clinic: string, _scope: unknown, mutate: (tx: typeof repos) => unknown) =>
      mutate(repos),
  );
  dependency(service, 'repos', repos);
  dependency(service, 'scheduleChangeImpact', impact);
  dependency(service, 'slotReconciliation', { save });
  dependency(
    service,
    'ensureBookingRulesForActiveMappings',
    vi.fn().mockResolvedValue({
      rules: [rule, { ...rule, id: 'rule-2', doctorId: otherDoctorId }],
      mappings: [doctorId, otherDoctorId].map((id) => ({
        doctorId: id,
        clinicServiceId: rule.clinicServiceId,
        active: true,
      })),
    }),
  );
  return { service, clinicalSetup, repos, impact, save };
}

describe('doctor settings ownership and shared persistence', () => {
  it('returns only the signed-in doctor booking rules while admins retain all rules', async () => {
    const { service } = setupService();
    expect(
      (await service.listBookingRules(clinicId, doctorId)).map((row) => row.doctor_id),
    ).toEqual([doctorId]);
    expect(await service.listBookingRules(clinicId)).toHaveLength(2);
  });

  it.each(['preview', 'save'] as const)(
    'rejects another doctor rule before %s or any job',
    async (action) => {
      const { service, repos, impact, save } = setupService();
      repos.slots.findBookingRule.mockResolvedValue([{ ...rule, doctorId: otherDoctorId }]);
      const result =
        action === 'preview'
          ? service.previewBookingRuleChange(
              clinicId,
              rule.id,
              { slot_duration_minutes: 30 },
              doctorId,
            )
          : service.patchBookingRule(clinicId, rule.id, { slot_duration_minutes: 30 }, doctorId);
      await expect(result).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(impact.previewBookingRuleChange).not.toHaveBeenCalled();
      expect(impact.applyBookingRuleUpdate).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    },
  );

  it('uses the canonical rule update for the own doctor and preserves conflict details', async () => {
    const { service, impact } = setupService();
    impact.previewBookingRuleChange.mockResolvedValueOnce({ blocked: true, conflicts });
    await expect(
      service.patchBookingRule(clinicId, rule.id, { slot_duration_minutes: 30 }, doctorId),
    ).rejects.toMatchObject({ code: 'CONFLICTING_APPOINTMENTS', details: { conflicts } });
    expect(impact.applyBookingRuleUpdate).not.toHaveBeenCalled();
    await service.patchBookingRule(clinicId, rule.id, { slot_duration_minutes: 30 }, doctorId);
    expect(impact.applyBookingRuleUpdate).toHaveBeenCalledWith(clinicId, rule.id, {
      slot_duration_minutes: 30,
    });
  });

  it('shows own and clinic/shared holidays without exposing unrelated doctor holidays', async () => {
    const { service, clinicalSetup } = setupService();
    clinicalSetup.listHolidays.mockResolvedValue(
      ['own', 'shared', 'clinic', 'other'].map((id) => ({ ...holiday, id })),
    );
    clinicalSetup.listHolidayDoctorMappings.mockResolvedValue([
      { holidayId: 'own', doctorId },
      { holidayId: 'shared', doctorId },
      { holidayId: 'shared', doctorId: otherDoctorId },
      { holidayId: 'other', doctorId: otherDoctorId },
    ]);
    expect((await service.listHolidays(clinicId, doctorId)).map((row) => row.id)).toEqual([
      'own',
      'shared',
      'clinic',
    ]);
    expect(await service.listHolidays(clinicId)).toHaveLength(4);
  });

  it.each([[], [otherDoctorId], [doctorId, otherDoctorId]].map((doctorIds) => ({ doctorIds })))(
    'rejects holiday scope $doctorIds for doctors',
    async ({ doctorIds }) => {
      const { service, impact, clinicalSetup, save } = setupService();
      await expect(
        service.createHoliday(
          clinicId,
          {
            holiday_date: holiday.holidayDate,
            active: true,
            is_full_day: true,
            doctor_ids: doctorIds,
          },
          actorId,
          doctorId,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        service.previewHolidayDate(clinicId, holiday.holidayDate, doctorIds, doctorId),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(impact.previewHolidayDate).not.toHaveBeenCalled();
      expect(clinicalSetup.insertHoliday).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    },
  );

  it('defaults an omitted holiday scope to self and saves through the doctor-scoped background job', async () => {
    const { service, impact, clinicalSetup, save, repos } = setupService();
    await service.previewHolidayDate(clinicId, holiday.holidayDate, undefined, doctorId);
    const created = await service.createHoliday(
      clinicId,
      { holiday_date: holiday.holidayDate, active: true, is_full_day: true },
      actorId,
      doctorId,
    );
    expect(created.doctor_ids).toEqual([doctorId]);
    expect(impact.previewHolidayDate).toHaveBeenLastCalledWith(
      clinicId,
      holiday.holidayDate,
      [doctorId],
      repos,
    );
    expect(clinicalSetup.replaceHolidayDoctors).toHaveBeenCalledWith(clinicId, holiday.id, [
      doctorId,
    ]);
    expect(save).toHaveBeenCalledWith(clinicId, { doctorId }, expect.any(Function));
    expect(clinicalSetup.insertHoliday).toHaveBeenCalledWith(
      expect.objectContaining({ createdByUserId: actorId }),
    );
  });

  it('blocks a holiday with appointments before any write or reconciliation job', async () => {
    const { service, impact, clinicalSetup, save } = setupService();
    impact.previewHolidayDate.mockResolvedValue({ blocked: true, conflicts });
    await expect(
      service.createHoliday(
        clinicId,
        { holiday_date: holiday.holidayDate, active: true, is_full_day: true },
        actorId,
        doctorId,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICTING_APPOINTMENTS', details: { conflicts } });
    expect(clinicalSetup.insertHoliday).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it.each([[], [otherDoctorId], [doctorId, otherDoctorId]].map((doctorIds) => ({ doctorIds })))(
    'keeps existing holiday scope $doctorIds read-only for a doctor',
    async ({ doctorIds }) => {
      const { service, clinicalSetup, save } = setupService();
      clinicalSetup.listHolidayDoctors.mockResolvedValue(doctorIds.map((id) => ({ doctorId: id })));
      await expect(
        service.patchHoliday(clinicId, holiday.id, { active: false }, doctorId),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(clinicalSetup.patchHoliday).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    },
  );

  it('rejects widening an own holiday to the clinic or another doctor', async () => {
    const { service, clinicalSetup, save } = setupService();
    await expect(
      service.patchHoliday(clinicId, holiday.id, { doctor_ids: [] }, doctorId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.patchHoliday(clinicId, holiday.id, { doctor_ids: [otherDoctorId] }, doctorId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(clinicalSetup.patchHoliday).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rechecks ownership under the save lock when an admin shares a holiday during editing', async () => {
    const { service, clinicalSetup } = setupService();
    clinicalSetup.listHolidayDoctors
      .mockResolvedValueOnce([{ doctorId }])
      .mockResolvedValueOnce([{ doctorId }])
      .mockResolvedValueOnce([{ doctorId }, { doctorId: otherDoctorId }]);
    await expect(
      service.patchHoliday(clinicId, holiday.id, { active: false }, doctorId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(clinicalSetup.patchHoliday).not.toHaveBeenCalled();
  });

  it('blocks an appointment that appears between holiday preview and the locked save', async () => {
    const { service, impact, clinicalSetup } = setupService();
    impact.previewHolidayDate
      .mockResolvedValueOnce({ blocked: false, conflicts: [] })
      .mockResolvedValueOnce({ blocked: true, conflicts });
    await expect(
      service.patchHoliday(clinicId, holiday.id, { holiday_date: '2026-11-24' }, doctorId),
    ).rejects.toMatchObject({ code: 'CONFLICTING_APPOINTMENTS', details: { conflicts } });
    expect(clinicalSetup.patchHoliday).not.toHaveBeenCalled();
  });

  it('updates/removes an own holiday in the shared record and leaves mappings intact when omitted', async () => {
    const { service, clinicalSetup, save } = setupService();
    await service.patchHoliday(clinicId, holiday.id, { active: false }, doctorId);
    expect(clinicalSetup.patchHoliday).toHaveBeenCalledWith(clinicId, holiday.id, {
      active: false,
    });
    expect(clinicalSetup.replaceHolidayDoctors).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(clinicId, { doctorId }, expect.any(Function));
  });

  it('rejects another doctor service mapping in a schedule before checking or saving slots', async () => {
    const { service, clinicalSetup, impact, save } = setupService();
    clinicalSetup.listDoctorServiceMappings.mockResolvedValue([
      { id: '00000000-0000-0000-0000-000000000301', doctorId: otherDoctorId },
    ]);
    await expect(
      service.replaceDoctorSchedules(clinicId, doctorId, {
        windows: [
          {
            doctor_service_id: '00000000-0000-0000-0000-000000000301',
            day_of_week: 1,
            start_time: '09:00',
            end_time: '13:00',
            active: true,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(impact.previewDoctorSchedulesReplace).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('doctor settings HTTP permissions', () => {
  let app: NestFastifyApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function application(auth: AuthContext) {
    const { service } = setupService();
    const module = await Test.createTestingModule({
      controllers: [ClinicClinicalController],
      providers: [
        { provide: ClinicClinicalService, useValue: service },
        { provide: DoctorHistoryService, useValue: {} },
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
    return app;
  }

  it('lets a doctor edit their rule through the real route and denies admin-only clinic writes', async () => {
    const server = await application({ userId: actorId, clinicId, clinicRole: 'doctor', doctorId });
    const saved = await server.inject({
      method: 'PATCH',
      url: `/clinics/${clinicId}/booking-rules/rule-1`,
      payload: { slot_duration_minutes: 30 },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().booking_rule.doctor_id).toBe(doctorId);
    for (const [method, path, payload] of [
      ['PUT', 'hours', { windows: [] }],
      ['PUT', 'doctor-schedules', { windows: [] }],
      ['PATCH', 'services/service-1', { service_name: 'Changed' }],
    ] as const) {
      expect(
        (await server.inject({ method, url: `/clinics/${clinicId}/${path}`, payload })).statusCode,
      ).toBe(403);
    }
  });

  it('preserves platform administrator access to rule and holiday writes without a clinic role', async () => {
    const server = await application({ userId: actorId, platformRole: 'platform_admin' });
    const requests = [
      { method: 'PATCH', path: 'booking-rules/rule-1', payload: { slot_duration_minutes: 30 } },
      {
        method: 'POST',
        path: 'booking-rules/rule-1/preview',
        payload: { slot_duration_minutes: 30 },
      },
      { method: 'POST', path: 'holidays', payload: { holiday_date: '2026-11-23' } },
      { method: 'POST', path: 'holidays/preview', payload: { holiday_date: '2026-11-23' } },
      { method: 'PATCH', path: 'holidays/holiday-1', payload: { active: false } },
    ] as const;
    for (const request of requests) {
      const response = await server.inject({
        method: request.method,
        url: `/clinics/${clinicId}/${request.path}`,
        payload: request.payload,
      });
      expect(response.statusCode, `${request.method} ${request.path}`).toBe(
        request.method === 'POST' ? 201 : 200,
      );
    }
  });

  it('keeps support access read-only without a clinic role on all five changed write routes', async () => {
    const server = await application({ userId: actorId, platformRole: 'support' });
    const requests = [
      { method: 'PATCH', path: 'booking-rules/rule-1', payload: { slot_duration_minutes: 30 } },
      {
        method: 'POST',
        path: 'booking-rules/rule-1/preview',
        payload: { slot_duration_minutes: 30 },
      },
      { method: 'POST', path: 'holidays', payload: { holiday_date: '2026-11-23' } },
      { method: 'POST', path: 'holidays/preview', payload: { holiday_date: '2026-11-23' } },
      { method: 'PATCH', path: 'holidays/holiday-1', payload: { active: false } },
    ] as const;
    for (const request of requests) {
      const response = await server.inject({
        method: request.method,
        url: `/clinics/${clinicId}/${request.path}`,
        payload: request.payload,
      });
      expect(response.statusCode, `${request.method} ${request.path}`).toBe(403);
    }
    for (const path of ['booking-rules', 'holidays']) {
      expect(
        (await server.inject({ method: 'GET', url: `/clinics/${clinicId}/${path}` })).statusCode,
      ).toBe(200);
    }
  });

  it('requires a linked doctor for lists, writes, previews and schedule reads/writes', async () => {
    const server = await application({ userId: actorId, clinicId, clinicRole: 'doctor' });
    const requests = [
      { method: 'GET', path: 'booking-rules' },
      { method: 'GET', path: 'holidays' },
      { method: 'PATCH', path: 'booking-rules/rule-1', payload: { slot_duration_minutes: 30 } },
      {
        method: 'POST',
        path: 'booking-rules/rule-1/preview',
        payload: { slot_duration_minutes: 30 },
      },
      { method: 'POST', path: 'holidays', payload: { holiday_date: '2026-11-23' } },
      { method: 'POST', path: 'holidays/preview', payload: { holiday_date: '2026-11-23' } },
      { method: 'PATCH', path: 'holidays/holiday-1', payload: { active: false } },
      { method: 'GET', path: `doctors/${doctorId}/schedules` },
      { method: 'PUT', path: `doctors/${doctorId}/schedules`, payload: { windows: [] } },
    ] as const;
    for (const request of requests) {
      const response = await server.inject({
        method: request.method,
        url: `/clinics/${clinicId}/${request.path}`,
        ...('payload' in request ? { payload: request.payload } : {}),
      });
      expect(response.statusCode, `${request.method} ${request.path}`).toBe(403);
    }
  });

  it('rejects another doctor schedule and cross-clinic access', async () => {
    const server = await application({ userId: actorId, clinicId, clinicRole: 'doctor', doctorId });
    for (const method of ['GET', 'PUT'] as const) {
      expect(
        (
          await server.inject({
            method,
            url: `/clinics/${clinicId}/doctors/${otherDoctorId}/schedules`,
            ...(method === 'PUT' ? { payload: { windows: [] } } : {}),
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/clinics/00000000-0000-0000-0000-000000000002/booking-rules',
        })
      ).statusCode,
    ).toBe(403);
  });
});
