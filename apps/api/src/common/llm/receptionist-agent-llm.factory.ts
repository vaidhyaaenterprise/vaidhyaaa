import { type ApiEnv } from '@vaidya/config';
import { AppError } from '@vaidya/shared';

import { AnthropicLlmClient } from './anthropic-client';
import { OpenAiCompatLlmClient } from './openai-compat-client';
import { SarvamLlmClient } from './sarvam-client';

export type ReceptionistAgentLlmClient = SarvamLlmClient | OpenAiCompatLlmClient | AnthropicLlmClient;

export function createReceptionistAgentLlmClient(
  env: ApiEnv,
  fetchImpl?: typeof fetch,
): ReceptionistAgentLlmClient {
  if (env.RECEPTIONIST_AGENT_PROVIDER === 'sarvam') {
    return SarvamLlmClient.fromEnvForReceptionistAgent(env, fetchImpl);
  }
  if (env.RECEPTIONIST_AGENT_PROVIDER === 'openai_compatible') {
    return OpenAiCompatLlmClient.fromEnv(env, fetchImpl);
  }
  if (env.RECEPTIONIST_AGENT_PROVIDER === 'anthropic') {
    return AnthropicLlmClient.fromEnv(env, fetchImpl);
  }
  throw new AppError(
    'INTERNAL_ERROR',
    `RECEPTIONIST_AGENT_PROVIDER must be sarvam, openai_compatible, or anthropic for tool-calling agent mode (got ${env.RECEPTIONIST_AGENT_PROVIDER}).`,
  );
}

/** @deprecated Use createReceptionistAgentLlmClient */
export const createAgentPlannerClient = createReceptionistAgentLlmClient;

export function isAgentModeEnabled(env: ApiEnv): boolean {
  return env.CONVERSATION_AGENT_MODE === 'agent';
}
