import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmRequestRuntimeOptions,
  LlmStreamHandlers,
} from '@vaidya/shared';

export type AgentLanguageCode = 'english' | 'ta_tanglish' | 'tamil';

export type AgentConversationTurn = {
  role: 'patient' | 'assistant';
  text: string;
};

export type AgentTurnStreamHandlers = {
  onReplyToken?: (token: string) => void;
  onFirstToken?: (elapsedMs: number) => void;
  onTtsChunk?: (chunk: string) => void;
};

export type AgentTurnLatencyMetrics = {
  turnType: 'fast_path' | 'trivial' | 'single_tool' | 'multi_tool' | 'timeout_fallback';
  totalMs: number;
  ttftMs?: number | null;
  llmCalls: number;
  fastPathKind?: string;
};

export type AgentTurnInput = {
  clinicName: string;
  clinicId: string;
  sessionId: string;
  languageCode: AgentLanguageCode;
  recentTurns: AgentConversationTurn[];
  collected: Record<string, unknown>;
  messageText: string;
  patientPhone?: string | null;
  lastAssistantMessageText?: string | null;
  streamHandlers?: AgentTurnStreamHandlers;
};

export type AgentSessionStatus = 'active' | 'completed' | 'escalated';

export type AgentTurnResult = {
  replyText: string;
  updatedCollected: Record<string, unknown>;
  toolsUsed: string[];
  sessionStatus: AgentSessionStatus;
  guardrailFlags?: string[];
  latencyMetrics?: AgentTurnLatencyMetrics;
  debug?: Record<string, unknown>;
};

export type AgentTurnOutcome =
  | { kind: 'agent'; result: AgentTurnResult }
  | { kind: 'fallback'; reason: string };

export interface ReceptionistAgentLlmPort {
  chat(request: LlmChatRequest, runtime?: LlmRequestRuntimeOptions): Promise<LlmChatResponse>;
  chatStream?(
    request: LlmChatRequest,
    runtime?: LlmRequestRuntimeOptions,
    handlers?: LlmStreamHandlers,
  ): Promise<LlmChatResponse>;
}

export const RECEPTIONIST_AGENT_LLM_PORT = Symbol('ReceptionistAgentLlmPort');
