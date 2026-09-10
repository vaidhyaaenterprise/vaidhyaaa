import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { loadLocalEnv } from '@vaidya/config';
import { AppError } from '@vaidya/shared';

import { AppModule } from '../app.module';
import { SlotHoldService } from '../modules/slots/slot-hold.service';

loadLocalEnv();

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';

async function main(): Promise<void> {
  const slotId = process.argv[2];
  const capacity = Number(process.argv[3] ?? '1');
  const attempts = Number(process.argv[4] ?? '2');

  if (!slotId) {
    console.error('Usage: tsx src/dev/hold-smoke.ts <SLOT_ID> [capacity] [attempts]');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const slotHold = app.get(SlotHoldService);

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        slotHold.holdSlot({ clinicId: CLINIC_ID, slotId }),
      ),
    );

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    console.log(JSON.stringify({
      slot_id: slotId,
      capacity_total: capacity,
      attempts,
      success_count: successes.length,
      failure_count: failures.length,
      failure_codes: failures.map((r) =>
        (r as PromiseRejectedResult).reason instanceof AppError
          ? (r as PromiseRejectedResult).reason.code
          : String((r as PromiseRejectedResult).reason),
      ),
    }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});