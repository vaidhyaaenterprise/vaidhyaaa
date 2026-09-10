import { Injectable } from '@nestjs/common';

import {
  type VoiceAdapter,
  type VoiceAdapterIncomingCallInput,
  type VoiceAdapterIncomingCallResult,
} from '@vaidya/shared';

@Injectable()
export class MockVoiceAdapter implements VoiceAdapter {
  async handleIncomingCall(input: VoiceAdapterIncomingCallInput): Promise<VoiceAdapterIncomingCallResult> {
    return {
      action: 'answer',
      callId: `mock-call-${input.providerCallId}`,
      sessionId: `mock-session-${input.providerCallId}`,
      greetingText: 'Vanakkam. Welcome to the clinic.',
      forwardTo: null,
      reason: 'mock_adapter',
    };
  }
}
