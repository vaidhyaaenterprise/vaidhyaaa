import { parseApiEnv } from '@vaidya/config';
import { CLINIC_AGENT_TOOLS, buildReceptionistAgentSystemPrompt } from '@vaidya/shared';

import { createReceptionistAgentLlmClient } from '../common/llm/receptionist-agent-llm.factory';

function providerApiKeyMissing(env: ReturnType<typeof parseApiEnv>): string | null {
  if (env.RECEPTIONIST_AGENT_PROVIDER === 'sarvam' && !env.SARVAM_API_KEY) {
    return 'SARVAM_API_KEY missing';
  }
  if (env.RECEPTIONIST_AGENT_PROVIDER === 'openai_compatible' && !env.OPENAI_COMPAT_API_KEY) {
    return 'OPENAI_COMPAT_API_KEY missing';
  }
  if (env.RECEPTIONIST_AGENT_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    return 'ANTHROPIC_API_KEY missing';
  }
  return null;
}

async function main(): Promise<void> {
  const env = parseApiEnv(process.env);
  const skipReason = providerApiKeyMissing(env);
  if (skipReason) {
    console.log(
      JSON.stringify(
        {
          mode: 'agent_tool_calling_smoke',
          skipped: true,
          reason: skipReason,
          provider: env.RECEPTIONIST_AGENT_PROVIDER,
        },
        null,
        2,
      ),
    );
    return;
  }

  const client = createReceptionistAgentLlmClient(env);
  const startedAt = Date.now();
  const response = await client.chat({
    model: env.RECEPTIONIST_AGENT_MODEL,
    messages: [
      { role: 'system', content: buildReceptionistAgentSystemPrompt('Demo Clinic') },
      {
        role: 'user',
        content: JSON.stringify({
          clinic_name: 'Demo Clinic',
          patient_message: 'Clinic enga locate aagiruku?',
          language_code: 'ta_tanglish',
        }),
      },
    ],
    tools: CLINIC_AGENT_TOOLS,
    toolChoice: 'auto',
    temperature: 0.3,
    maxTokens: env.RECEPTIONIST_AGENT_MAX_TOKENS,
  });

  console.log(
    JSON.stringify(
      {
        mode: 'agent_tool_calling_smoke',
        skipped: false,
        provider: env.RECEPTIONIST_AGENT_PROVIDER,
        model: response.model,
        latency_ms: Date.now() - startedAt,
        content_preview: response.content.slice(0, 200),
        tool_calls: response.toolCalls ?? [],
        finish_reason: response.finishReason ?? null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
