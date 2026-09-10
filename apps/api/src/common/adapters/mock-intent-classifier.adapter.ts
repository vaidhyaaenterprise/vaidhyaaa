import { Injectable } from '@nestjs/common';

import {
  classifyIntentMock,
  type IntentClassifierAdapter,
  type IntentClassifierInput,
  type IntentClassifierResult,
} from '@vaidya/shared';

@Injectable()
export class MockIntentClassifierAdapter implements IntentClassifierAdapter {
  async classify(input: IntentClassifierInput): Promise<IntentClassifierResult> {
    return classifyIntentMock(input);
  }
}
