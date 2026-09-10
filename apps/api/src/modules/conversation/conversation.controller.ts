import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';

import {
  AppError,
  createConversationSessionSchema,
  sendConversationMessageSchema,
} from '@vaidya/shared';

import { Public } from '../../common/decorators/public.decorator';

import { ConversationService } from './conversation.service';

@Controller('conversations')
export class ConversationController {
  constructor(@Inject(ConversationService) private readonly conversationService: ConversationService) {}

  @Public()
  @Post()
  async createSession(@Body() body: unknown) {
    const parsed = createConversationSessionSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid conversation session payload.');
    }

    const session = await this.conversationService.createSession(parsed.data);
    return { session };
  }

  @Public()
  @Get(':sessionId')
  getSession(@Param('sessionId') sessionId: string) {
    return this.conversationService.getSession(sessionId);
  }

  @Public()
  @Post(':sessionId/messages')
  async sendMessage(@Param('sessionId') sessionId: string, @Body() body: unknown) {
    const parsed = sendConversationMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid conversation message payload.');
    }

    return this.conversationService.sendMessage(sessionId, parsed.data);
  }
}
