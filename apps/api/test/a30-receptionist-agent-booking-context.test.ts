import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { parseApiEnv } from '@vaidya/config';

import { API_ENV } from '../src/config/api-config.module';
import { AgentTurnAuditService } from '../src/modules/conversation/agent-turn-audit.service';
import { ReceptionistAgentToolsService } from '../src/modules/conversation/receptionist-agent-tools';
import { ReceptionistAgentService } from '../src/modules/conversation/receptionist-agent.service';
import {
  RECEPTIONIST_AGENT_LLM_PORT,
  type ReceptionistAgentLlmPort,
} from '../src/modules/conversation/receptionist-agent.types';

const testEnv = parseApiEnv({
  NODE_ENV: 'test',
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
  JWT_SECRET: 'test-secret',
  RECEPTIONIST_AGENT_PROVIDER: 'sarvam',
  SARVAM_API_KEY: 'sk-test',
  RECEPTIONIST_AGENT_MAX_TOOL_ROUNDS: '4',
  DEBUG_API: 'true',
});

describe('A30 receptionist agent booking context payload', () => {
  it('includes booking_context with one-question guidance in the LLM user payload', async () => {
    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>().mockResolvedValue({
      model: 'mock-model',
      content: 'Enna date-ku appointment venum?',
      finishReason: 'stop',
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReceptionistAgentService,
        { provide: API_ENV, useValue: testEnv },
        { provide: RECEPTIONIST_AGENT_LLM_PORT, useValue: { chat: llmChat } },
        { provide: ReceptionistAgentToolsService, useValue: { execute: vi.fn(), tryAutoMapDoctor: vi.fn().mockResolvedValue(null) } },
        {
          provide: AgentTurnAuditService,
          useValue: { recordToolCall: vi.fn(), recordAgentReply: vi.fn() },
        },
      ],
    }).compile();

    const service = moduleRef.get(ReceptionistAgentService);
    await service.handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000099',
      languageCode: 'ta_tanglish',
      recentTurns: [
        {
          role: 'assistant',
          text: 'Vanakkam! I need a few details before booking.',
        },
      ],
      collected: { reason_for_visit: 'knee pain' },
      messageText: 'I need few more details before booking',
      lastAssistantMessageText: 'Vanakkam! I need a few details before booking.',
    });

    expect(llmChat).toHaveBeenCalledTimes(1);
    const userMessage = llmChat.mock.calls[0]?.[0]?.messages?.[1]?.content;
    expect(typeof userMessage).toBe('string');
    const payload = JSON.parse(userMessage as string) as {
      booking_context?: {
        state: string;
        next_action: string;
        patient_move?: string;
        reply_rules: string[];
      };
    };
    expect(payload.booking_context).toMatchObject({
      state: 'ASK_DATE',
      next_action: 'ask_preferred_date',
      patient_move: 'meta_question_what_details_needed',
    });
    expect(payload.booking_context?.reply_rules.some((rule) => rule.includes('ONE short question'))).toBe(
      true,
    );
  });
});
