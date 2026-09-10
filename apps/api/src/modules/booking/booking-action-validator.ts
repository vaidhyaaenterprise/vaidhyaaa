import { Inject, Injectable } from '@nestjs/common';

import { AppError, type ActionValidationContext, type ActionValidator } from '@vaidya/shared';

import { ADAPTER_TOKENS } from '@vaidya/shared';

@Injectable()
export class BookingActionValidator {
  constructor(
    @Inject(ADAPTER_TOKENS.ActionValidator)
    private readonly actionValidator: ActionValidator,
  ) {}

  async validateCreateAppointment(context: ActionValidationContext): Promise<void> {
    await this.actionValidator.validateCreateAppointment(context);
    const payload = context.payload;
    if (!payload.patient_name || typeof payload.patient_name !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'Patient name is required.', { field: 'patient_name' });
    }
    if (!payload.reason_for_visit || typeof payload.reason_for_visit !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'Reason for visit is required.', {
        field: 'reason_for_visit',
      });
    }
    if (!payload.slot_id || typeof payload.slot_id !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'Slot is required.', { field: 'slot_id' });
    }
    if (!payload.hold_id || typeof payload.hold_id !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'Active hold is required.', { field: 'hold_id' });
    }
  }
}

@Injectable()
export class DefaultActionValidator implements ActionValidator {
  async validateWrite(_context: ActionValidationContext): Promise<void> {
    return;
  }

  async validateCreateAppointment(_context: ActionValidationContext): Promise<void> {
    return;
  }
}
