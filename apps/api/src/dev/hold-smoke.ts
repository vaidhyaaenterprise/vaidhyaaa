import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { loadLocalEnv } from '@vaidya/config';
import { AppError } from '@vaidya/shared';

import { AppModule } from '../app.module';
import { SlotHoldService } from '../modules/slots/slot-hold.service';
import { SlotRuleChangeImpactService } from '../modules/slots/slot-rule-change-impact.service';
import { SlotService } from '../modules/slots/slot.service';

loadLocalEnv();

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';

function printHelp(): void {
  console.log(`Manual A03 slot/hold smoke tool

Usage:
  pnpm --filter @vaidya/api slot:smoke <command> [args]

Commands:
  availability <SLOT_ID>
  hold <SLOT_ID> [phone]
  concurrent <SLOT_ID> <capacity> <attempts>
  confirm <SLOT_ID> <HOLD_ID> [patient_name]
  confirm-expired <SLOT_ID> <HOLD_ID> [patient_name]
  cancel <APPOINTMENT_ID>
  capacity-preview <RULE_ID> <new_capacity>
  capacity-apply <RULE_ID> <new_capacity>
  duration-apply <RULE_ID> <new_duration_minutes>

Examples:
  pnpm --filter @vaidya/api slot:smoke availability <uuid>
  pnpm --filter @vaidya/api slot:smoke hold <uuid>
  pnpm --filter @vaidya/api slot:smoke concurrent <uuid> 1 2
  pnpm --filter @vaidya/api slot:smoke concurrent <uuid> 3 4
  pnpm --filter @vaidya/api slot:smoke confirm <uuid> <hold_uuid>
  pnpm --filter @vaidya/api slot:smoke confirm-expired <uuid> <hold_uuid>
  pnpm --filter @vaidya/api slot:smoke cancel <appointment_uuid>
  pnpm --filter @vaidya/api slot:smoke capacity-preview <rule_uuid> 1
  pnpm --filter @vaidya/api slot:smoke capacity-apply <rule_uuid> 2
  pnpm --filter @vaidya/api slot:smoke duration-apply <rule_uuid> 30`);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function errorCode(error: unknown): string {
  return error instanceof AppError ? error.code : String(error);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(command ? 0 : 1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const slotService = app.get(SlotService);
    const slotHold = app.get(SlotHoldService);
    const ruleChange = app.get(SlotRuleChangeImpactService);

    switch (command) {
      case 'availability': {
        const slotId = process.argv[3];
        if (!slotId) throw new Error('Missing SLOT_ID');
        printJson(await slotService.getSlotAvailability(CLINIC_ID, slotId));
        return;
      }

      case 'hold': {
        const slotId = process.argv[3];
        const phone = process.argv[4];
        if (!slotId) throw new Error('Missing SLOT_ID');
        const hold = await slotHold.holdSlot({
          clinicId: CLINIC_ID,
          slotId,
          ...(phone ? { patientPhone: phone } : {}),
        });
        printJson({
          hold_id: hold.id,
          status: hold.status,
          hold_expires_at: hold.holdExpiresAt.toISOString(),
        });
        return;
      }

      case 'concurrent': {
        const slotId = process.argv[3];
        const capacity = Number(process.argv[4] ?? '1');
        const attempts = Number(process.argv[5] ?? '2');
        if (!slotId) throw new Error('Missing SLOT_ID');

        const results = await Promise.allSettled(
          Array.from({ length: attempts }, () => slotHold.holdSlot({ clinicId: CLINIC_ID, slotId })),
        );
        const successes = results.filter((result) => result.status === 'fulfilled');
        const failures = results.filter((result) => result.status === 'rejected');

        printJson({
          slot_id: slotId,
          capacity_total: capacity,
          attempts,
          success_count: successes.length,
          failure_count: failures.length,
          failure_codes: failures.map((result) => errorCode((result as PromiseRejectedResult).reason)),
          hold_ids: successes.map(
            (result) => (result as PromiseFulfilledResult<{ id: string }>).value.id,
          ),
        });
        return;
      }

      case 'confirm': {
        const slotId = process.argv[3];
        const holdId = process.argv[4];
        const patientName = process.argv[5] ?? 'Manual Test Patient';
        if (!slotId || !holdId) throw new Error('Missing SLOT_ID or HOLD_ID');

        const appointment = await slotHold.createAppointmentFromHold({
          clinicId: CLINIC_ID,
          slotId,
          holdId,
          patientName,
          reasonForVisit: 'Manual smoke test',
        });
        printJson({
          appointment_id: appointment.id,
          status: appointment.status,
          slot_id: appointment.slotId,
        });
        return;
      }

      case 'confirm-expired': {
        const slotId = process.argv[3];
        const holdId = process.argv[4];
        const patientName = process.argv[5] ?? 'Manual Test Patient';
        if (!slotId || !holdId) throw new Error('Missing SLOT_ID or HOLD_ID');

        try {
          const appointment = await slotHold.confirmAfterExpiredHold({
            clinicId: CLINIC_ID,
            slotId,
            holdId,
            patientName,
            reasonForVisit: 'Manual smoke test after expiry',
          });
          printJson({
            outcome: 'appointment_created',
            appointment_id: appointment.id,
            status: appointment.status,
          });
        } catch (error) {
          printJson({
            outcome: 'blocked',
            code: errorCode(error),
            message: error instanceof Error ? error.message : String(error),
          });
          process.exitCode = 1;
        }
        return;
      }

      case 'cancel': {
        const appointmentId = process.argv[3];
        if (!appointmentId) throw new Error('Missing APPOINTMENT_ID');
        const appointment = await slotHold.cancelAppointment(CLINIC_ID, appointmentId);
        printJson({
          appointment_id: appointment.id,
          status: appointment.status,
        });
        return;
      }

      case 'capacity-preview': {
        const ruleId = process.argv[3];
        const newCapacity = Number(process.argv[4]);
        if (!ruleId || Number.isNaN(newCapacity)) {
          throw new Error('Missing RULE_ID or new_capacity');
        }
        printJson(await ruleChange.previewCapacityChange(CLINIC_ID, ruleId, newCapacity));
        return;
      }

      case 'capacity-apply': {
        const ruleId = process.argv[3];
        const newCapacity = Number(process.argv[4]);
        if (!ruleId || Number.isNaN(newCapacity)) {
          throw new Error('Missing RULE_ID or new_capacity');
        }
        try {
          printJson(await ruleChange.applyCapacityChange(CLINIC_ID, ruleId, newCapacity));
        } catch (error) {
          printJson({
            outcome: 'blocked',
            code: errorCode(error),
            message: error instanceof Error ? error.message : String(error),
            details: error instanceof AppError ? error.details : undefined,
          });
          process.exitCode = 1;
        }
        return;
      }

      case 'duration-apply': {
        const ruleId = process.argv[3];
        const newDuration = Number(process.argv[4]);
        if (!ruleId || Number.isNaN(newDuration)) {
          throw new Error('Missing RULE_ID or new_duration_minutes');
        }
        try {
          printJson(await ruleChange.applyDurationChange(CLINIC_ID, ruleId, newDuration));
        } catch (error) {
          printJson({
            outcome: 'blocked',
            code: errorCode(error),
            message: error instanceof Error ? error.message : String(error),
            details: error instanceof AppError ? error.details : undefined,
          });
          process.exitCode = 1;
        }
        return;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
