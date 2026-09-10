import { Body, Controller, Inject, Param, Post } from '@nestjs/common';

import {
  AppError,
  voiceCallEventSchema,
  voiceIncomingCallSchema,
  voiceRecordingReadySchema,
  voiceTranscriptTurnSchema,
} from '@vaidya/shared';

import { Public } from '../../common/decorators/public.decorator';

import { VoiceCallSessionServiceImpl } from './voice-call-session.service';

@Controller('voice/calls')
export class VoiceController {
  constructor(
    @Inject(VoiceCallSessionServiceImpl)
    private readonly voiceCallSession: VoiceCallSessionServiceImpl,
  ) {}

  @Public()
  @Post('incoming')
  async incoming(@Body() body: unknown) {
    const parsed = voiceIncomingCallSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid incoming voice call payload.');
    }

    const result = await this.voiceCallSession.handleIncomingCall(parsed.data);
    return result;
  }

  @Public()
  @Post(':callId/transcript-turn')
  async transcriptTurn(@Param('callId') callId: string, @Body() body: unknown) {
    const parsed = voiceTranscriptTurnSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid voice transcript turn payload.');
    }

    return this.voiceCallSession.processTranscriptTurn(callId, parsed.data);
  }

  @Public()
  @Post(':callId/events')
  async callEvent(@Param('callId') callId: string, @Body() body: unknown) {
    const parsed = voiceCallEventSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid voice call event payload.');
    }

    return this.voiceCallSession.processCallEvent(callId, parsed.data);
  }

  @Public()
  @Post(':callId/recording-ready')
  async recordingReady(@Param('callId') callId: string, @Body() body: unknown) {
    const parsed = voiceRecordingReadySchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid recording-ready payload.');
    }

    return this.voiceCallSession.handleRecordingReady(callId, parsed.data);
  }
}
