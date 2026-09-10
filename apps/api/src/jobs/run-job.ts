import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { loadLocalEnv } from '@vaidya/config';
import { JOB_QUEUE_MAP, JOB_TYPES, type JobType } from '@vaidya/shared';

import { AppModule } from '../app.module';
import { JobExecutorService } from '../common/jobs/job-executor.service';

loadLocalEnv();

const JOB_ALIASES: Record<string, string> = {
  'slot-generation': JOB_TYPES.GENERATE_SLOTS,
  'slot-hold-expiry': JOB_TYPES.EXPIRE_SLOT_HOLDS,
};

async function main(): Promise<void> {
  const alias = process.argv[2];
  if (!alias) {
    console.error('Usage: pnpm --filter @vaidya/api jobs:run <slot-generation|slot-hold-expiry>');
    process.exit(1);
  }

  const jobType = JOB_ALIASES[alias] as JobType;
  if (!jobType) {
    console.error(`Unknown job alias: ${alias}`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const executor = app.get(JobExecutorService);
    await executor.runValidatedJob(jobType, JOB_QUEUE_MAP[jobType], {});
    console.log(JSON.stringify({ job_type: jobType, status: 'completed' }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  } else {
    console.error(error);
  }
  process.exit(1);
});
