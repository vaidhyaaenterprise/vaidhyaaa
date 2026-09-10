import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Controller, Get, Header, Inject, NotFoundException } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';

import { Public } from '../common/decorators/public.decorator';
import { API_ENV } from '../config/api-config.module';

function loadConsoleHtml(): string {
  const candidates = [
    join(process.cwd(), 'dev/conversation-console.html'),
    join(__dirname, '../../dev/conversation-console.html'),
    join(__dirname, '../../../dev/conversation-console.html'),
  ];

  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      continue;
    }
  }

  throw new Error('conversation-console.html not found');
}

@Controller('dev')
export class ConversationDevController {
  private cachedHtml: string | null = null;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  @Public()
  @Get('conversation-console')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getConversationConsole(): string {
    if (this.env.APP_ENV === 'production' || this.env.NODE_ENV === 'production') {
      throw new NotFoundException('Conversation console is not available in production.');
    }

    if (!this.cachedHtml) {
      this.cachedHtml = loadConsoleHtml();
    }

    return this.cachedHtml;
  }
}
