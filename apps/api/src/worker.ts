import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';

import { loadLocalEnv, parseApiEnv } from '@vaidya/config';
import { ADAPTER_TOKENS, type WorkerBootstrap } from '@vaidya/shared';

import { ApiConfigModule } from './config/api-config.module';
import { AdaptersModule } from './common/adapters/adapters.module';
import { JobInfrastructureModule } from './common/jobs/job-infrastructure.module';
import { LoggerModule } from './common/logger/logger.module';
import { AppLogger } from './common/logger/logger.service';
import { DatabaseModule } from './modules/database/database.module';
import { JobsModule } from './modules/jobs/jobs.module';

loadLocalEnv();

@Module({
  imports: [
    ApiConfigModule,
    LoggerModule,
    AdaptersModule,
    DatabaseModule,
    JobInfrastructureModule,
    JobsModule,
  ],
})
class WorkerAppModule {}

async function bootstrapWorker(): Promise<void> {
  const env = parseApiEnv();
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    bufferLogs: true,
  });

  const logger = app.get(AppLogger);
  app.useLogger(logger);

  const worker = app.get<WorkerBootstrap>(ADAPTER_TOKENS.WorkerBootstrap);
  await worker.start();

  logger.log(
    JSON.stringify({
      event: 'worker_process_ready',
      queue_mode: env.QUEUE_MODE,
      worker_enabled: env.JOB_WORKER_ENABLED,
    }),
    'WorkerBootstrap',
  );

  const shutdown = async () => {
    await worker.stop();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

bootstrapWorker().catch((error: unknown) => {
  console.error('Failed to start worker', error);
  process.exit(1);
});
