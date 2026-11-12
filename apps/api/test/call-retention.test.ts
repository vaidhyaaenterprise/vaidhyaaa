import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseConnection, Repositories } from '@vaidya/db';
import { JOB_TYPES, type JobRegistry, type ObjectStorageProvider } from '@vaidya/shared';
import { CallRetentionService } from '../src/modules/call-inbox/call-retention.service';
import { CallRetentionController } from '../src/modules/call-inbox/call-retention.controller';

const clinicId = '00000000-0000-0000-0000-000000000001';
function setup() {
  const storage = { delete: vi.fn().mockResolvedValue(undefined) };
  const registry = { register: vi.fn() };
  const repo = {
    listExpiredCalls: vi.fn().mockResolvedValue([]),
    deleteExpiredCall: vi.fn().mockResolvedValue(true),
  };
  const service = new CallRetentionService(
    { db: {} } as DatabaseConnection,
    storage as unknown as ObjectStorageProvider,
    registry as unknown as JobRegistry,
  );
  (service as unknown as { repos: Repositories }).repos = {
    callInbox: repo,
  } as unknown as Repositories;
  return { service, repo, storage, registry };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Call history retention', () => {
  it('uses the fixed 45-day cutoff, removes managed media first, and drains multiple batches', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
    const { service, repo, storage } = setup();
    repo.listExpiredCalls
      .mockResolvedValueOnce([
        { id: 'call-1', clinicId, recordingStorageKey: 'recordings/1', recordingDeletedAt: null },
      ])
      .mockResolvedValueOnce([{ id: 'call-2', clinicId, recordingStorageKey: null }]);
    await expect(service.cleanup(clinicId)).resolves.toEqual({ deleted: 2, retention_days: 45 });
    expect(repo.listExpiredCalls).toHaveBeenCalledWith(
      new Date('2026-09-09T12:00:00Z'),
      100,
      clinicId,
    );
    expect(repo.deleteExpiredCall).toHaveBeenCalledWith(
      clinicId,
      'call-1',
      new Date('2026-09-09T12:00:00Z'),
    );
    expect(storage.delete).toHaveBeenCalledWith('recordings/1');
    expect(storage.delete.mock.invocationCallOrder[0]).toBeLessThan(
      repo.deleteExpiredCall.mock.invocationCallOrder[0]!,
    );
    expect(repo.listExpiredCalls).toHaveBeenCalledTimes(3);
  });

  it('does not orphan failed recordings, still processes other calls, and reports failure for retry', async () => {
    const { service, repo, storage } = setup();
    repo.listExpiredCalls.mockResolvedValueOnce([
      { id: 'call-1', clinicId, recordingStorageKey: 'recordings/failed' },
      { id: 'call-2', clinicId, recordingStorageKey: null },
    ]);
    storage.delete.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(service.cleanup()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(repo.deleteExpiredCall).toHaveBeenCalledTimes(1);
    expect(repo.deleteExpiredCall).toHaveBeenCalledWith(clinicId, 'call-2', expect.any(Date));
  });

  it('retries DB failures and safely handles a call already removed by another worker', async () => {
    const { service, repo } = setup();
    repo.listExpiredCalls.mockResolvedValueOnce([{ id: 'call-1', clinicId }]);
    repo.deleteExpiredCall.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(service.cleanup()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    repo.listExpiredCalls.mockResolvedValueOnce([{ id: 'call-1', clinicId }]);
    repo.deleteExpiredCall.mockResolvedValueOnce(false);
    await expect(service.cleanup()).resolves.toMatchObject({ deleted: 0 });
  });

  it('registers a real cleanup handler for the persistent worker', async () => {
    const { service, registry, repo } = setup();
    service.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(
      JOB_TYPES.CLEANUP_EXPIRED_CALLS,
      expect.any(Function),
    );
    await registry.register.mock.calls[0]![1]({ clinic_id: clinicId });
    expect(repo.listExpiredCalls).toHaveBeenCalledWith(expect.any(Date), 100, clinicId);
  });

  it('does not report success when the serverless processing budget is exhausted', async () => {
    const { service, repo } = setup();
    const now = Date.now();
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(now)
      .mockReturnValue(now + 20_000);
    try {
      await expect(service.cleanup()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(repo.listExpiredCalls).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
});

describe('Call retention cron authorization', () => {
  it('serves the exact configured cron path with the real application prefix exclusions', async () => {
    vi.stubEnv('CRON_SECRET', 'retention-test-secret');
    const cleanup = vi.fn().mockResolvedValue({ deleted: 0, retention_days: 45 });
    const module = await Test.createTestingModule({
      controllers: [CallRetentionController],
      providers: [{ provide: CallRetentionService, useValue: { cleanup } }],
    }).compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('v1', { exclude: [{ path: 'internal/(.*)', method: RequestMethod.ALL }] });
    try {
      await app.init();
      const config = JSON.parse(readFileSync(resolve(__dirname, '../vercel.json'), 'utf8'));
      const cron = config.crons.find((item: { path: string }) =>
        item.path.endsWith('/call-retention'),
      );
      expect(cron.schedule).toBe('30 3 * * *');
      const response = await app.inject({
        method: 'GET',
        url: cron.path,
        headers: { authorization: 'Bearer retention-test-secret' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ deleted: 0, retention_days: 45 });
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it('rejects missing or incorrect secrets without calling cleanup', () => {
    const { service } = setup();
    const cleanup = vi.spyOn(service, 'cleanup');
    const controller = new CallRetentionController(service);
    vi.stubEnv('CRON_SECRET', 'retention-test-secret');
    for (const header of [undefined, 'wrong', 'Bearer wrong-test-secret']) {
      expect(() => controller.run(header)).toThrow('A valid cron secret is required.');
    }
    vi.stubEnv('CRON_SECRET', '');
    expect(() => controller.run('Bearer ')).toThrow('A valid cron secret is required.');
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('executes cleanup only for an authenticated scheduler', async () => {
    const { service, repo } = setup();
    vi.stubEnv('CRON_SECRET', 'retention-test-secret');
    await expect(
      new CallRetentionController(service).run('Bearer retention-test-secret'),
    ).resolves.toEqual({ deleted: 0, retention_days: 45 });
    expect(repo.listExpiredCalls).toHaveBeenCalledOnce();
  });
});
