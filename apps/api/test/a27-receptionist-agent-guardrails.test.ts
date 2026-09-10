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

const auditMock = {
  recordToolCall: vi.fn(),
  recordAgentReply: vi.fn(),
};

describe('A27 receptionist agent guardrails', () => {
  it('blocks hallucinated fee amounts not returned by tools', async () => {
    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>().mockResolvedValue({
      model: 'mock-model',
      content: 'Consultation with Dr Priya is ₹999. Shall I book you in?',
      finishReason: 'stop',
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReceptionistAgentService,
        { provide: API_ENV, useValue: testEnv },
        { provide: RECEPTIONIST_AGENT_LLM_PORT, useValue: { chat: llmChat } },
        { provide: ReceptionistAgentToolsService, useValue: { execute: vi.fn(), tryAutoMapDoctor: vi.fn().mockResolvedValue(null) } },
        { provide: AgentTurnAuditService, useValue: auditMock },
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
      messageText: 'How much is consultation?',
    });

    expect(outcome.kind).toBe('agent');
    if (outcome.kind !== 'agent') {
      return;
    }

    expect(outcome.result.replyText).not.toMatch(/999/);
    expect(outcome.result.replyText.toLowerCase()).toMatch(/verify|fees|timings|booking/);
    expect(outcome.result.guardrailFlags?.length).toBeGreaterThan(0);
    expect(auditMock.recordAgentReply).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: '00000000-0000-0000-0000-000000000099',
        guardrailFlags: expect.arrayContaining([expect.stringMatching(/fee:/)]),
      }),
    );
  });

  it('rejects create_appointment_request without explicit patient confirmation', async () => {
    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>();
    llmChat.mockResolvedValueOnce({
      model: 'mock-model',
      content: '',
      toolCalls: [
        {
          id: 'call_create_unconfirmed',
          type: 'function' as const,
          function: {
            name: 'create_appointment_request',
            arguments: JSON.stringify({
              patientName: 'Priya',
              phone: '+919876543210',
              doctorName: 'Kumar',
              reasonForVisit: 'knee pain',
              date: '2026-07-11',
              slotId: '00000000-0000-0000-0000-000000000501',
              confirmedByPatient: true,
            }),
          },
        },
      ],
      finishReason: 'tool_calls',
    });
    llmChat.mockResolvedValueOnce({
      model: 'mock-model',
      content: 'I still need your confirmation before I can book that slot.',
      finishReason: 'stop',
    });

    const toolsExecute = vi.fn().mockResolvedValue({ error: 'need_explicit_confirmation_first' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReceptionistAgentService,
        { provide: API_ENV, useValue: testEnv },
        { provide: RECEPTIONIST_AGENT_LLM_PORT, useValue: { chat: llmChat } },
        { provide: ReceptionistAgentToolsService, useValue: { execute: toolsExecute, tryAutoMapDoctor: vi.fn().mockResolvedValue(null) } },
        { provide: AgentTurnAuditService, useValue: auditMock },
      ],
    }).compile();

    const service = moduleRef.get(ReceptionistAgentService);
    const outcome = await service.handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000100',
      languageCode: 'english',
      recentTurns: [{ role: 'assistant', text: 'Which doctor would you like to see?' }],
      collected: {
        patient_name: 'Priya',
        reason_for_visit: 'knee pain',
      },
      messageText: 'book it now please',
      patientPhone: '+919876543210',
    });

    expect(outcome.kind).toBe('agent');
    if (outcome.kind !== 'agent') {
      return;
    }

    expect(toolsExecute).toHaveBeenCalledWith(
      'create_appointment_request',
      expect.objectContaining({ confirmedByPatient: true }),
      expect.any(Object),
    );
    expect(outcome.result.updatedCollected.appointment_id).toBeUndefined();
    expect(auditMock.recordToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'create_appointment_request',
        result: { error: 'need_explicit_confirmation_first' },
      }),
    );
  });

  it('short-circuits medical advice requests before the tool loop', async () => {
    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>();
    const toolsExecute = vi.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReceptionistAgentService,
        { provide: API_ENV, useValue: testEnv },
        { provide: RECEPTIONIST_AGENT_LLM_PORT, useValue: { chat: llmChat } },
        { provide: ReceptionistAgentToolsService, useValue: { execute: toolsExecute } },
        { provide: AgentTurnAuditService, useValue: auditMock },
      ],
    }).compile();

    const service = moduleRef.get(ReceptionistAgentService);
    const outcome = await service.handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000101',
      languageCode: 'english',
      recentTurns: [],
      collected: {},
      messageText: 'should I take paracetamol for fever?',
    });

    expect(outcome.kind).toBe('agent');
    if (outcome.kind !== 'agent') {
      return;
    }

    expect(llmChat).not.toHaveBeenCalled();
    expect(toolsExecute).not.toHaveBeenCalled();
    expect(outcome.result.replyText.toLowerCase()).toMatch(/can't advise|cannot advise|medicines|medical/);
    expect(outcome.result.guardrailFlags ?? []).toEqual(['medical_advice_refusal']);
  });
});
