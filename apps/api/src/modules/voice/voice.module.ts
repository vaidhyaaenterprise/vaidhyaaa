import { Module } from '@nestjs/common';

import { ADAPTER_TOKENS } from '@vaidya/shared';

import { ConversationModule } from '../conversation/conversation.module';

import { CallRecordingStorageService } from './call-recording-storage.service';
import { VoiceAnsweringPolicyService } from './voice-answering-policy.service';
import { VoiceCallSessionServiceImpl } from './voice-call-session.service';
import { VoiceController } from './voice.controller';

@Module({
  imports: [ConversationModule],
  controllers: [VoiceController],
  providers: [
    VoiceAnsweringPolicyService,
    CallRecordingStorageService,
    VoiceCallSessionServiceImpl,
    {
      provide: ADAPTER_TOKENS.CallRecordingStorage,
      useExisting: CallRecordingStorageService,
    },
    {
      provide: ADAPTER_TOKENS.VoiceCallSessionService,
      useExisting: VoiceCallSessionServiceImpl,
    },
  ],
  exports: [
    VoiceCallSessionServiceImpl,
    ADAPTER_TOKENS.VoiceCallSessionService,
    ADAPTER_TOKENS.CallRecordingStorage,
  ],
})
export class VoiceModule {}
