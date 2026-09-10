import { Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import {
  attachStateEntityLlmDebug,
  applyContextualStateEntityFallback,
  buildCompactExtractorUserPayload,
  buildSarvamLlmDebug,
  COMPACT_EXTRACTOR_SYSTEM_PROMPT,
  correctActiveStateEntityResult,
  parseStateEntityExtractorJson,
  llmRuntimeToClientOptions,
  maxTokensForRequest,
  tryDeterministicActiveStateEntity,
  type StateEntityExtractorAdapter,
  type StateEntityExtractorInput,
  type StateEntityExtractorResult,
  type LlmChatRequest,
} from '@vaidya/shared';

import { SarvamLlmClient } from '../llm/sarvam-client';

@Injectable()
export class SarvamStateEntityExtractorAdapter implements StateEntityExtractorAdapter {
  private readonly client: SarvamLlmClient;
  private readonly primaryModel: string;
  private readonly fallbackModel: string;

  constructor(private readonly env: ApiEnv) {
    this.client = SarvamLlmClient.fromEnvForStateExtractor(env);
    this.primaryModel = env.STATE_ENTITY_EXTRACTOR_MODEL;
    this.fallbackModel = env.STATE_ENTITY_EXTRACTOR_FALLBACK_MODEL;
  }

  async extract(input: StateEntityExtractorInput): Promise<StateEntityExtractorResult> {
    const parseContext = {
      currentState: input.currentState,
      currentFlow: input.currentFlow,
      messageText: input.messageText,
      referenceDate: input.referenceDate,
    };

    const deterministic = tryDeterministicActiveStateEntity(input);
    if (deterministic) {
      return attachStateEntityLlmDebug(
        deterministic,
        {
          role: 'state_entity_extractor',
          provider: 'deterministic',
          llm_called: false,
          skipped_reason: 'deterministic_preflight',
        },
      );
    }

    const runtime = input.llmRuntime ? llmRuntimeToClientOptions(input.llmRuntime) : undefined;
    const userPayload = buildCompactExtractorUserPayload(input);
    const request: LlmChatRequest = {
      model: '',
      messages: [
        { role: 'system', content: COMPACT_EXTRACTOR_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      responseFormat: 'json_object',
      temperature: 0,
      maxTokens: maxTokensForRequest(input.llmRuntime),
    };

    const startedAt = Date.now();
    const primary = await this.client.chat(
      {
        ...request,
        model: this.primaryModel,
      },
      runtime,
    );
    const parsed = parseStateEntityExtractorJson(primary.content, parseContext);
    if (parsed) {
      const corrected = correctActiveStateEntityResult(input, parsed);
      if (
        input.llmRuntime?.enableFallback !== false &&
        this.client.shouldUseFallback(corrected.confidence, undefined, runtime)
      ) {
        const fallbackStartedAt = Date.now();
        const fallback = await this.client.chatFallback(
          {
            ...request,
            model: this.fallbackModel,
          },
          runtime,
        );
        const fallbackParsed = parseStateEntityExtractorJson(fallback.content, parseContext);
        if (fallbackParsed) {
          const fallbackCorrected = correctActiveStateEntityResult(input, fallbackParsed);
          return attachStateEntityLlmDebug(
            fallbackCorrected,
            buildSarvamLlmDebug({
              role: 'state_entity_extractor',
              model: fallback.model,
              rawResponse: fallback.content,
              latencyMs: Date.now() - fallbackStartedAt,
              parsed: fallbackCorrected as unknown as Record<string, unknown>,
            }),
          );
        }
      }

      return attachStateEntityLlmDebug(
        corrected,
        buildSarvamLlmDebug({
          role: 'state_entity_extractor',
          model: primary.model,
          rawResponse: primary.content,
          latencyMs: Date.now() - startedAt,
          parsed: corrected as unknown as Record<string, unknown>,
        }),
      );
    }

    if (input.llmRuntime?.skipJsonRepair) {
      return applyContextualStateEntityFallback(parseContext);
    }

    const repair = await this.client.chat(
      {
        ...request,
        model: this.primaryModel,
        messages: [
          {
            role: 'system',
            content: `${COMPACT_EXTRACTOR_SYSTEM_PROMPT}\nReturn valid JSON only.`,
          },
          { role: 'user', content: primary.content },
        ],
      },
      runtime,
    );
    const repaired = parseStateEntityExtractorJson(repair.content, parseContext);
    if (repaired) {
      const corrected = correctActiveStateEntityResult(input, repaired);
      return attachStateEntityLlmDebug(
        corrected,
        buildSarvamLlmDebug({
          role: 'state_entity_extractor',
          model: repair.model,
          rawResponse: repair.content,
          latencyMs: Date.now() - startedAt,
          parsed: corrected as unknown as Record<string, unknown>,
        }),
      );
    }

    return applyContextualStateEntityFallback(parseContext);
  }
}
