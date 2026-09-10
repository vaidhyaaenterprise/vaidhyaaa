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
  RECEPTIONIST_AGENT_FASTPATH_MODEL: 'sarvam-30b',
  SARVAM_API_KEY: 'sk-test',
  RECEPTIONIST_AGENT_MAX_TOOL_ROUNDS: '4',
  DEBUG_API: 'true',
});

function buildModule(llmChat: ReceptionistAgentLlmPort['chat'], toolsExecute = vi.fn()) {
  return Test.createTestingModule({
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
}

describe('A32 receptionist agent 105b booking flow', () => {
  it('routes tool-loop calls to sarvam-105b and forced text-only to sarvam-30b', async () => {
    const llmChat = vi
      .fn<ReceptionistAgentLlmPort['chat']>()
      .mockResolvedValueOnce({
        model: 'sarvam-105b',
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'update_booking_state',
              arguments: JSON.stringify({ fields: { reason_for_visit: 'knee pain' } }),
            },
          },
        ],
        finishReason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        model: 'sarvam-105b',
        content: 'Sure — which date works for your knee pain appointment?',
        finishReason: 'stop',
      });

    const toolsExecute = vi.fn().mockResolvedValue({
      collected: { reason_for_visit: 'knee pain' },
      mergedFields: ['reason_for_visit'],
    });

    const moduleRef = await buildModule(llmChat, toolsExecute);
    const service = moduleRef.get(ReceptionistAgentService);

    const outcome = await service.handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000099',
      languageCode: 'english',
      recentTurns: [],
      collected: {},
      messageText: 'Knee pain appointment venum',
    });

    expect(outcome.kind).toBe('agent');
    if (outcome.kind !== 'agent') {
      return;
    }

    expect(llmChat).toHaveBeenCalled();
    expect(llmChat.mock.calls[0]?.[0]?.model).toBe('sarvam-105b');
    expect(outcome.result.replyText).toBe('Sure — which date works for your knee pain appointment?');
    expect(outcome.result.replyText).not.toBe('Enna date-ku appointment venum?');
    expect(outcome.result.updatedCollected.reason_for_visit).toBe('knee pain');
    expect(outcome.result.toolsUsed).toContain('update_booking_state');
  });

  it('keeps doctor_name from preflight safety net when the LLM skips update_booking_state', async () => {
    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>().mockResolvedValue({
      model: 'sarvam-105b',
      content: 'Got it — what date would you like?',
      finishReason: 'stop',
    });

    const toolsExecute = vi.fn().mockImplementation(async (toolName: string, args: Record<string, unknown>) => {
      if (toolName === 'update_booking_state') {
        const fields = args.fields as Record<string, unknown>;
        return {
          collected: {
            reason_for_visit: 'knee pain',
            doctor_name: fields.doctor_name,
          },
          mergedFields: Object.keys(fields),
        };
      }
      return {};
    });

    const moduleRef = await buildModule(llmChat, toolsExecute);
    const service = moduleRef.get(ReceptionistAgentService);
    const outcome = await service.handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000099',
      languageCode: 'english',
      recentTurns: [],
      collected: { reason_for_visit: 'knee pain' },
      messageText: 'Doctor Kumar',
    });

    expect(outcome.kind).toBe('agent');
    if (outcome.kind !== 'agent') {
      return;
    }

    expect(toolsExecute).toHaveBeenCalledWith(
      'update_booking_state',
      expect.objectContaining({
        fields: expect.objectContaining({ doctor_name: 'kumar' }),
      }),
      expect.any(Object),
    );
    expect(outcome.result.updatedCollected.doctor_name).toBe('kumar');
    expect(outcome.result.replyText).toBe('Got it — what date would you like?');
    expect(outcome.result.guardrailFlags ?? []).not.toContain('booking_reply_steered');
  });

  it('steers only multi-question dumps, not single natural LLM questions', async () => {
    const dumpLlm = vi.fn<ReceptionistAgentLlmPort['chat']>().mockResolvedValue({
      model: 'sarvam-105b',
      content:
        'Enna doctor-a paakanum? Date enna? Time preference morning/afternoon/evening? Patient name sollunga.',
      finishReason: 'stop',
    });

    const moduleRefDump = await buildModule(dumpLlm);
    const dumpOutcome = await moduleRefDump.get(ReceptionistAgentService).handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000099',
      languageCode: 'ta_tanglish',
      recentTurns: [],
      collected: { reason_for_visit: 'knee pain' },
      messageText: 'I need few more details before booking',
    });

    expect(dumpOutcome.kind).toBe('agent');
    if (dumpOutcome.kind !== 'agent') {
      return;
    }
    expect(dumpOutcome.result.replyText).toBe('Enna date-ku appointment venum?');
    expect(dumpOutcome.result.guardrailFlags).toContain('booking_reply_steered');

    const singleLlm = vi.fn<ReceptionistAgentLlmPort['chat']>().mockResolvedValue({
      model: 'sarvam-105b',
      content: 'Seri — enna date-ku varringa?',
      finishReason: 'stop',
    });
    const moduleRefSingle = await buildModule(singleLlm);
    const singleOutcome = await moduleRefSingle.get(ReceptionistAgentService).handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000100',
      languageCode: 'ta_tanglish',
      recentTurns: [],
      collected: { reason_for_visit: 'knee pain' },
      messageText: 'I need few more details before booking',
    });

    expect(singleOutcome.kind).toBe('agent');
    if (singleOutcome.kind !== 'agent') {
      return;
    }
    expect(singleOutcome.result.replyText).toBe('Seri — enna date-ku varringa?');
    expect(singleOutcome.result.guardrailFlags ?? []).not.toContain('booking_reply_steered');
  });
});
