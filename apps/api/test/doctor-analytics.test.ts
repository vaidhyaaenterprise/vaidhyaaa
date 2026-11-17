import { afterEach, describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Repositories } from '@vaidya/db';
import type { AuthContext } from '@vaidya/shared';

import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { AUTH_CONTEXT_KEY } from '../src/common/guards/auth.guard';
import { RbacGuard } from '../src/common/guards/rbac.guard';
import type { AppLogger } from '../src/common/logger/logger.service';
import { AppointmentAdminService } from '../src/modules/appointment/appointment-admin.service';
import { AppointmentLifecycleService } from '../src/modules/appointment/appointment-lifecycle.service';
import { AppointmentsController } from '../src/modules/appointment/appointments.controller';
import {
  AppointmentsService,
  type DoctorAnalyticsItem,
} from '../src/modules/appointment/appointments.service';

const clinicId = '00000000-0000-4000-8000-000000000301';
const doctorId = '00000000-0000-4000-8000-000000000401';
const userId = '00000000-0000-4000-8000-000000000101';

const repositoryResult = {
  stats: {
    confirmedThisMonth: 9,
    newConfirmedThisMonth: 4,
    followUpConfirmedThisMonth: 5,
    averageConfirmedPerDay: 3,
  },
  trends: {
    daily: [
      {
        periodStart: '2026-11-17',
        label: '17 Nov',
        total: 3,
        newPatients: 2,
        followUps: 1,
      },
    ],
    weekly: [],
    monthly: [],
  },
  topConditions: [{ condition: 'Back Pain', count: 7 }],
  ageGroups: [{ label: '31–45', count: 6 }],
  monthlySummary: [
    {
      periodStart: '2026-11-01',
      label: 'Nov 2026',
      total: 12,
      newPatients: 7,
      followUps: 5,
      averagePerDay: 2,
    },
  ],
};

const expectedContract: DoctorAnalyticsItem = {
  stats: {
    confirmed_this_month: 9,
    new_confirmed_this_month: 4,
    follow_up_confirmed_this_month: 5,
    average_confirmed_per_day: 3,
  },
  trends: {
    daily: [
      {
        period_start: '2026-11-17',
        label: '17 Nov',
        total: 3,
        new_patients: 2,
        follow_ups: 1,
      },
    ],
    weekly: [],
    monthly: [],
  },
  top_conditions: [{ condition: 'Back Pain', count: 7 }],
  age_groups: [{ label: '31–45', count: 6 }],
  monthly_summary: [
    {
      period_start: '2026-11-01',
      label: 'Nov 2026',
      total: 12,
      new_patients: 7,
      follow_ups: 5,
      average_per_day: 2,
    },
  ],
};

function serviceWithRepository() {
  const markPastConfirmedNoShows = vi.fn().mockResolvedValue(1);
  const getDoctorAnalytics = vi.fn().mockResolvedValue(repositoryResult);
  const service = Object.create(AppointmentsService.prototype) as AppointmentsService;
  (service as unknown as { repos: Repositories }).repos = {
    appointmentLifecycle: { markPastConfirmedNoShows, getDoctorAnalytics },
  } as unknown as Repositories;
  return { service, markPastConfirmedNoShows, getDoctorAnalytics };
}

describe('doctor analytics service', () => {
  it('reconciles no-shows before returning the snake_case aggregate contract', async () => {
    const { service, markPastConfirmedNoShows, getDoctorAnalytics } = serviceWithRepository();

    await expect(service.getDoctorAnalytics({ clinicId, doctorId })).resolves.toEqual(
      expectedContract,
    );
    expect(markPastConfirmedNoShows).toHaveBeenCalledWith(clinicId);
    expect(getDoctorAnalytics).toHaveBeenCalledWith(clinicId, doctorId);
    expect(markPastConfirmedNoShows.mock.invocationCallOrder[0]).toBeLessThan(
      getDoctorAnalytics.mock.invocationCallOrder[0]!,
    );
  });

  it('does not return stale analytics when no-show reconciliation fails', async () => {
    const { service, markPastConfirmedNoShows, getDoctorAnalytics } = serviceWithRepository();
    markPastConfirmedNoShows.mockRejectedValueOnce(new Error('Database unavailable'));

    await expect(service.getDoctorAnalytics({ clinicId, doctorId })).rejects.toThrow(
      'Database unavailable',
    );
    expect(getDoctorAnalytics).not.toHaveBeenCalled();
  });
});

describe('doctor analytics authorization', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function application(auth: AuthContext) {
    const getDoctorAnalytics = vi.fn().mockResolvedValue(expectedContract);
    const module = await Test.createTestingModule({
      controllers: [AppointmentsController],
      providers: [
        { provide: AppointmentsService, useValue: { getDoctorAnalytics } },
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
    return { app, getDoctorAnalytics };
  }

  it('binds the analytics route to the authenticated doctor', async () => {
    const { app: server, getDoctorAnalytics } = await application({
      userId,
      clinicId,
      clinicRole: 'doctor',
      doctorId,
    });

    const response = await server.inject({
      method: 'GET',
      url: `/clinics/${clinicId}/appointments/analytics`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ analytics: expectedContract });
    expect(getDoctorAnalytics).toHaveBeenCalledWith({ clinicId, doctorId });
  });

  it.each([
    {
      name: 'an unlinked doctor',
      auth: { userId, clinicId, clinicRole: 'doctor' as const },
    },
    {
      name: 'a doctor linked to another clinic',
      auth: {
        userId,
        clinicId: '00000000-0000-4000-8000-000000000399',
        clinicRole: 'doctor' as const,
        doctorId,
      },
    },
    {
      name: 'a clinic administrator',
      auth: { userId, clinicId, clinicRole: 'clinic_admin' as const },
    },
  ])('rejects $name without querying analytics', async ({ auth }) => {
    const { app: server, getDoctorAnalytics } = await application(auth);

    const response = await server.inject({
      method: 'GET',
      url: `/clinics/${clinicId}/appointments/analytics`,
    });

    expect(response.statusCode).toBe(403);
    expect(getDoctorAnalytics).not.toHaveBeenCalled();
  });
});
