import { Module } from '@nestjs/common';

import {
  ActiveStateInterpretationLogger,
  ActiveStateInterpretationService,
} from './active-state-interpretation.service';

@Module({
  providers: [ActiveStateInterpretationLogger, ActiveStateInterpretationService],
  exports: [ActiveStateInterpretationService],
})
export class ActiveStateModule {}
