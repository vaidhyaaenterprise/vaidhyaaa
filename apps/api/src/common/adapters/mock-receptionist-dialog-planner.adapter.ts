import { Injectable } from '@nestjs/common';

import { planReceptionistDialogMock, type ReceptionistDialogPlannerAdapter } from '@vaidya/shared';
import type { ReceptionistDialogInput, ReceptionistDialogPlan } from '@vaidya/shared';

@Injectable()
export class MockReceptionistDialogPlannerAdapter implements ReceptionistDialogPlannerAdapter {
  async plan(input: ReceptionistDialogInput): Promise<ReceptionistDialogPlan> {
    return planReceptionistDialogMock(input);
  }
}
