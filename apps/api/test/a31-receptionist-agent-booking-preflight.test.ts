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
  RECEPTIONIST_AGENT_MODEL: 'sarvam-105b',
  SARVAM_API_KEY: 'sk-test',
  RECEPTIONIST_AGENT_MAX_TOOL_ROUNDS: '4',
  DEBUG_API: 'true',
});

describe('A31 receptionist agent booking preflight safety net', () => {
  it('persists extracted fields via preflight even when the LLM writes the reply', async () => {
    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>().mockResolvedValue({
      model: 'sarvam-105b',
      content: 'Sure — which date should I check for your knee pain appointment?',
      finishReason: 'stop',
    });
    const toolsExecute = vi.fn().mockImplementation(async (toolName: string, args: Record<string, unknown>) => {
      if (toolName === 'update_booking_state') {
        const fields = args.fields as Record<string, unknown>;
        return {
          collected: {
            reason_for_visit: fields.reason_for_visit,
          },
          mergedFields: Object.keys(fields),
        };
      }
      return {};
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReceptionistAgentService,
        { provide: API_ENV, useValue: testEnv },
        { provide: RECEPTIONIST_AGENT_LLM_PORT, useValue: { chat: llmChat } },
        { provide: ReceptionistAgentToolsService, useValue: { execute: toolsExecute, tryAutoMapDoctor: vi.fn().mockResolvedValue(null) } },
        {
          provide: AgentTurnAuditService,
          useValue: { recordToolCall: vi.fn(), recordAgentReply: vi.fn() },
        },
      ],
    }).compile();

    const service = moduleRef.get(ReceptionistAgentService);
    const outcome = await service.handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000099',
      languageCode: 'english',
      recentTurns: [],
      collected: {},
      messageText: 'Knee pain ku appointment venum',
    });

    expect(outcome.kind).toBe('agent');
    if (outcome.kind !== 'agent') {
      return;
    }

    expect(llmChat).toHaveBeenCalled();
    expect(toolsExecute).toHaveBeenCalledWith(
      'update_booking_state',
      expect.objectContaining({
        fields: expect.objectContaining({ reason_for_visit: 'knee pain' }),
      }),
      expect.any(Object),
    );
    expect(outcome.result.replyText).toContain('date');
    expect(outcome.result.updatedCollected.reason_for_visit).toBe('knee pain');
    expect(outcome.result.toolsUsed).toContain('update_booking_state');
  });
});
