import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseConnection, Repositories } from '@vaidya/db';
import { JOB_TYPES, type JobRegistry } from '@vaidya/shared';

import { AppointmentNoShowController } from '../src/modules/appointment/appointment-no-show.controller';
import { AppointmentNoShowService } from '../src/modules/appointment/appointment-no-show.service';
import { AppointmentsService } from '../src/modules/appointment/appointments.service';

afterEach(() => vi.unstubAllEnvs());

describe('automatic no-show reconciliation', () => {
  it('registers a real scheduled handler and propagates failures for retry', async () => {
    const register = vi.fn();
    const markPastConfirmedNoShows = vi.fn().mockResolvedValue(2);
    const service = new AppointmentNoShowService(
      { db: {} } as DatabaseConnection,
      { register } as unknown as JobRegistry,
    );
    (service as unknown as { repos: Repositories }).repos = {
      appointmentLifecycle: { markPastConfirmedNoShows },
    } as unknown as Repositories;
    service.onModuleInit();
    expect(register).toHaveBeenCalledWith(
      JOB_TYPES.MARK_APPOINTMENT_NO_SHOWS,
      expect.any(Function),
    );
    await register.mock.calls[0]![1]({ clinic_id: 'clinic-1' });
    expect(markPastConfirmedNoShows).toHaveBeenCalledWith('clinic-1');
    await expect(service.reconcile()).resolves.toEqual({ updated: 2 });
    markPastConfirmedNoShows.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(register.mock.calls[0]![1]({})).rejects.toThrow('Database unavailable');
  });

  it('reconciles before listing appointments and preserves the doctor and status filters', async () => {
    const markPastConfirmedNoShows = vi.fn().mockResolvedValue(1);
    const listAppointmentsForClinic = vi.fn().mockResolvedValue([]);
    const service = Object.create(AppointmentsService.prototype) as AppointmentsService;
    (service as unknown as { repos: Repositories }).repos = {
      appointmentLifecycle: { markPastConfirmedNoShows, listAppointmentsForClinic },
      clinical: {
        listDoctors: vi.fn().mockResolvedValue([]),
        listServices: vi.fn().mockResolvedValue([]),
      },
      patients: { listVisitsByAppointmentIds: vi.fn().mockResolvedValue([]) },
    } as unknown as Repositories;
    await expect(
      service.listAppointments({
        clinicId: 'clinic-1',
        doctorId: 'doctor-1',
        status: ['confirmed', 'no_show'],
      }),
    ).resolves.toEqual([]);
    expect(markPastConfirmedNoShows).toHaveBeenCalledWith('clinic-1');
    expect(markPastConfirmedNoShows.mock.invocationCallOrder[0]).toBeLessThan(
      listAppointmentsForClinic.mock.invocationCallOrder[0]!,
    );
    expect(listAppointmentsForClinic).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      doctorId: 'doctor-1',
      statuses: ['confirmed', 'no_show'],
    });
    markPastConfirmedNoShows.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(service.listAppointments({ clinicId: 'clinic-1' })).rejects.toThrow(
      'Database unavailable',
    );
    expect(listAppointmentsForClinic).toHaveBeenCalledOnce();
  });

  it('rejects unauthorized scheduler requests without changing appointments', () => {
    const reconcile = vi.fn();
    const controller = new AppointmentNoShowController({
      reconcile,
    } as unknown as AppointmentNoShowService);
    vi.stubEnv('CRON_SECRET', 'no-show-test-secret');
    for (const header of [undefined, 'wrong', 'Bearer wrong-test-secret']) {
      expect(() => controller.run(header)).toThrow('A valid cron secret is required');
    }
    vi.stubEnv('CRON_SECRET', '');
    expect(() => controller.run('Bearer ')).toThrow('A valid cron secret is required');
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('serves the configured daily after-midnight-India job at its actual unprefixed route', async () => {
    vi.stubEnv('CRON_SECRET', 'no-show-test-secret');
    const reconcile = vi.fn().mockResolvedValue({ updated: 3 });
    const module = await Test.createTestingModule({
      controllers: [AppointmentNoShowController],
      providers: [{ provide: AppointmentNoShowService, useValue: { reconcile } }],
    }).compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('v1', { exclude: [{ path: 'internal/(.*)', method: RequestMethod.ALL }] });
    try {
      await app.init();
      const config = JSON.parse(readFileSync(resolve(__dirname, '../vercel.json'), 'utf8'));
      const cron = config.crons.find((entry: { path: string }) =>
        entry.path.endsWith('/appointment-no-shows'),
      );
      expect(cron.schedule).toBe('0 19 * * *');
      const response = await app.inject({
        method: 'GET',
        url: cron.path,
        headers: { authorization: 'Bearer no-show-test-secret' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ updated: 3 });
      expect(reconcile).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });
});
