import { Controller, Get, Inject, Param, Query } from '@nestjs/common';

import { AppError, CALL_INBOX_OUTCOMES, type CallInboxOutcome } from '@vaidya/shared';

import { ClinicAdmin } from '../../common/decorators/platform-admin.decorator';
import { ClinicScoped } from '../../common/decorators/clinic-scoped.decorator';

import { CallInboxService } from './call-inbox.service';

const OUTCOME_SET = new Set<string>(CALL_INBOX_OUTCOMES);

function parseDate(value: string | undefined, label: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError('VALIDATION_ERROR', `${label} must be a valid ISO date.`);
  }
  return parsed;
}

function parseOutcomes(value: string | string[] | undefined): CallInboxOutcome[] | undefined {
  if (!value) return undefined;
  const values = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
  const invalid = values.find((entry) => !OUTCOME_SET.has(entry));
  if (invalid) {
    throw new AppError('VALIDATION_ERROR', `Unsupported call outcome: ${invalid}.`);
  }
  return [...new Set(values)] as CallInboxOutcome[];
}

@Controller('clinics/:clinicId/call-inbox')
@ClinicScoped()
export class CallInboxController {
  constructor(@Inject(CallInboxService) private readonly callInbox: CallInboxService) {}

  @Get()
  @ClinicAdmin()
  async list(
    @Param('clinicId') clinicId: string,
    @Query('outcomes') outcomes: string | string[] | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('limit') limitValue: string | undefined,
  ) {
    const limit = limitValue === undefined ? 200 : Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new AppError('VALIDATION_ERROR', 'limit must be an integer between 1 and 200.');
    }
    const parsedFrom = parseDate(from, 'from');
    const parsedTo = parseDate(to, 'to');
    if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
      throw new AppError('VALIDATION_ERROR', 'from must be before to.');
    }
    const parsedOutcomes = parseOutcomes(outcomes);

    return this.callInbox.list({
      clinicId,
      limit,
      ...(parsedOutcomes ? { outcomes: parsedOutcomes } : {}),
      ...(parsedFrom ? { from: parsedFrom } : {}),
      ...(parsedTo ? { to: parsedTo } : {}),
    });
  }
}
