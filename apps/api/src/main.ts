import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { RequestMethod } from '@nestjs/common';

import { parseApiEnv, loadLocalEnv } from '@vaidya/config';
import { REQUEST_ID_HEADER } from '@vaidya/shared';

import { DEV_AUTH_HEADERS } from './common/constants/auth.constants';

import { AppModule } from './app.module';
import { AppLogger } from './common/logger/logger.service';

loadLocalEnv();

async function bootstrap(): Promise<void> {
  const env = parseApiEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { bufferLogs: true },
  );

  const logger = app.get(AppLogger);
  app.useLogger(logger);

  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  fastify.addHook('preHandler', async (request) => {
    const url = request.raw.url ?? '';
    if (!url.includes('/api/tools')) return;
    logger.log(
      `Incoming tool payload >> ${request.method} ${url} | headers=${JSON.stringify({
        'content-type': request.headers['content-type'],
        'x-request-id': request.headers['x-request-id'],
        'user-agent': request.headers['user-agent'],
      })} | query=${JSON.stringify(request.query)} | body=${JSON.stringify(request.body)}`,
      'SarvamPayload',
    );
  });

  const corsOrigins = env.CORS_ORIGINS.split(',')
    .map((origin: string) => origin.trim())
    .filter((origin: string) => origin.length > 0);
  const corsOriginSetting =
    env.NODE_ENV === 'production' ? (corsOrigins.length > 0 ? corsOrigins : true) : true;

  app.enableCors({
    origin: corsOriginSetting,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Accept',
      REQUEST_ID_HEADER,
      DEV_AUTH_HEADERS.USER_ID,
      DEV_AUTH_HEADERS.CLINIC_ID,
      DEV_AUTH_HEADERS.USER_ROLE,
      DEV_AUTH_HEADERS.DOCTOR_ID,
      'Authorization',
    ],
  });

  app.setGlobalPrefix('v1', {
    exclude: [{ path: 'internal/(.*)', method: RequestMethod.ALL }],
  });

  await app.listen(env.API_PORT, '0.0.0.0');
  logger.log(`Vaidya API listening on port ${env.API_PORT}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start API', error);
  process.exit(1);
});
