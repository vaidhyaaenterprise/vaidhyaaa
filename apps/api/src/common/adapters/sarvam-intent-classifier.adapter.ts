import { Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import {
  attachIntentClassifierLlmDebug,
  buildCompactClassifierUserPayload,
  buildSafetyIntentClassification,
  buildSarvamLlmDebug,
  COMPACT_CLASSIFIER_SYSTEM_PROMPT,
  detectMessageSafety,
  llmRuntimeToClientOptions,
  maxTokensForRequest,
  parseIntentClassifierJson,
  unknownIntentClassifierResult,
  type IntentClassifierAdapter,
  type IntentClassifierInput,
  type IntentClassifierResult,
  type LlmChatRequest,
} from '@vaidya/shared';

import { SarvamLlmClient } from '../llm/sarvam-client';

@Injectable()
export class SarvamIntentClassifierAdapter implements IntentClassifierAdapter {
  private readonly client: SarvamLlmClient;

  constructor(env: ApiEnv) {
    this.client = SarvamLlmClient.fromEnv(env);
  }

  async classify(input: IntentClassifierInput): Promise<IntentClassifierResult> {
    const safety = detectMessageSafety(input.messageText);
    if (safety.isEmergency || safety.isMedicalAdviceRequest) {
      return buildSafetyIntentClassification(input.languageCode, safety);
    }

    const runtime = input.llmRuntime ? llmRuntimeToClientOptions(input.llmRuntime) : undefined;
    const userPayload = buildCompactClassifierUserPayload(input);
    const request: LlmChatRequest = {
      model: '',
      messages: [
        { role: 'system', content: COMPACT_CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      responseFormat: 'json_object',
      temperature: 0,
      maxTokens: maxTokensForRequest(input.llmRuntime),
    };

    const startedAt = Date.now();
    let primary: Awaited<ReturnType<SarvamLlmClient['chat']>>;
    try {
      primary = await this.client.chat(request, runtime);
    } catch {
      return unknownIntentClassifierResult(input.languageCode);
    }

    const parsed = parseIntentClassifierJson(primary.content, input.languageCode);
    if (parsed) {
      if (
        input.llmRuntime?.enableFallback !== false &&
        this.client.shouldUseFallback(parsed.confidence, undefined, runtime)
      ) {
        const fallbackStartedAt = Date.now();
        try {
          const fallback = await this.client.chatFallback(request, runtime);
          const fallbackParsed = parseIntentClassifierJson(fallback.content, input.languageCode);
          if (fallbackParsed) {
            return attachIntentClassifierLlmDebug(
              fallbackParsed,
              buildSarvamLlmDebug({
                role: 'intent_classifier',
                model: fallback.model,
                rawResponse: fallback.content,
                latencyMs: Date.now() - fallbackStartedAt,
                parsed: fallbackParsed as unknown as Record<string, unknown>,
              }),
            );
          }
        } catch {
          return unknownIntentClassifierResult(input.languageCode);
        }
      }

      return attachIntentClassifierLlmDebug(
        parsed,
        buildSarvamLlmDebug({
          role: 'intent_classifier',
          model: primary.model,
          rawResponse: primary.content,
          latencyMs: Date.now() - startedAt,
          parsed: parsed as unknown as Record<string, unknown>,
        }),
      );
    }

    if (input.llmRuntime?.skipJsonRepair) {
      return unknownIntentClassifierResult(input.languageCode);
    }

    try {
      const repair = await this.client.chat(
        {
          ...request,
          messages: [
            {
              role: 'system',
              content: `${COMPACT_CLASSIFIER_SYSTEM_PROMPT}\nReturn valid JSON only.`,
            },
            { role: 'user', content: primary.content },
          ],
        },
        runtime,
      );

      const repaired = parseIntentClassifierJson(repair.content, input.languageCode);
      if (repaired) {
        return attachIntentClassifierLlmDebug(
          repaired,
          buildSarvamLlmDebug({
            role: 'intent_classifier',
            model: repair.model,
            rawResponse: repair.content,
            latencyMs: Date.now() - startedAt,
            parsed: repaired as unknown as Record<string, unknown>,
          }),
        );
      }
    } catch {
      return unknownIntentClassifierResult(input.languageCode);
    }

    return unknownIntentClassifierResult(input.languageCode);
  }
}
