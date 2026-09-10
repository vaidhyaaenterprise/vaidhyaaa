import { Injectable } from '@nestjs/common';

import {
  extractStateEntitiesMock,
  type StateEntityExtractorAdapter,
  type StateEntityExtractorInput,
  type StateEntityExtractorResult,
} from '@vaidya/shared';

@Injectable()
export class MockStateEntityExtractorAdapter implements StateEntityExtractorAdapter {
  async extract(input: StateEntityExtractorInput): Promise<StateEntityExtractorResult> {
    return extractStateEntitiesMock(input);
  }
}
