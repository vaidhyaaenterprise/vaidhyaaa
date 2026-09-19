import { HttpStatus } from '@nestjs/common';
import { type FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { HealthController } from '../src/modules/health/health.controller';
import { type HealthService, type InfraHealthStatus } from '../src/modules/health/health.service';

function createSubject(infraStatus: InfraHealthStatus) {
  const healthService = {
    getInfraStatus: vi.fn().mockResolvedValue(infraStatus),
  } as unknown as HealthService;
  const reply = {
    status: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;

  return {
    controller: new HealthController(healthService),
    reply,
  };
}

describe('HealthController readiness', () => {
  it('keeps a successful readiness response at HTTP 200', async () => {
    const infraStatus: InfraHealthStatus = {
      database: 'ok',
      queue_mode: 'inline',
      redis_connected: null,
      worker_enabled: false,
    };
    const { controller, reply } = createSubject(infraStatus);

    await expect(controller.getInfraHealth(reply)).resolves.toEqual(infraStatus);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('returns HTTP 503 when the database is unavailable', async () => {
    const infraStatus: InfraHealthStatus = {
      database: 'error',
      queue_mode: 'inline',
      redis_connected: null,
      worker_enabled: false,
    };
    const { controller, reply } = createSubject(infraStatus);

    await expect(controller.getInfraHealth(reply)).resolves.toEqual(infraStatus);
    expect(reply.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('returns HTTP 503 when Redis is required but unavailable', async () => {
    const infraStatus: InfraHealthStatus = {
      database: 'ok',
      queue_mode: 'bullmq',
      redis_connected: false,
      worker_enabled: true,
    };
    const { controller, reply } = createSubject(infraStatus);

    await expect(controller.getInfraHealth(reply)).resolves.toEqual(infraStatus);
    expect(reply.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
