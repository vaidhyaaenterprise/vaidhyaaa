import { Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import {
  buildCompactServiceRouterUserPayload,
  COMPACT_SERVICE_ROUTER_SYSTEM_PROMPT,
  llmRuntimeToClientOptions,
  maxTokensForRequest,
  parseServiceRouterJson,
  routeServiceFromProfiles,
  type LlmChatRequest,
  type ServiceRouterAdapter,
  type ServiceRouterInput,
  type ServiceRouterResult,
} from '@vaidya/shared';

import { SarvamLlmClient } from '../llm/sarvam-client';

@Injectable()
export class SarvamServiceRouterAdapter implements ServiceRouterAdapter {
  private readonly client: SarvamLlmClient;

  constructor(env: ApiEnv) {
    this.client = SarvamLlmClient.fromEnv(env);
  }

  private parseContext(input: ServiceRouterInput) {
    return {
      reasonForVisit: input.reasonForVisit,
      activeClinicServices: input.activeClinicServices,
      ...(input.patientAgeHint !== undefined ? { patientAgeHint: input.patientAgeHint } : {}),
    };
  }

  async route(input: ServiceRouterInput): Promise<ServiceRouterResult> {
    const runtime = input.llmRuntime ? llmRuntimeToClientOptions(input.llmRuntime) : undefined;
    const userPayload = buildCompactServiceRouterUserPayload(input);

    const request: LlmChatRequest = {
      model: '',
      messages: [
        { role: 'system', content: COMPACT_SERVICE_ROUTER_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      responseFormat: 'json_object',
      temperature: 0,
      maxTokens: maxTokensForRequest(input.llmRuntime, 160),
    };

    const primary = await this.client.chat(request, runtime);
    const parsedRaw = this.client.parseJsonContent<unknown>(primary.content);
    const parsed = parsedRaw ? parseServiceRouterJson(parsedRaw, this.parseContext(input)) : null;
    if (parsed) {
      if (
        input.llmRuntime?.enableFallback !== false &&
        this.client.shouldUseFallback(parsed.confidence, undefined, runtime)
      ) {
        const fallback = await this.client.chatFallback(request, runtime);
        const fallbackParsedRaw = this.client.parseJsonContent<unknown>(fallback.content);
        const fallbackParsed = fallbackParsedRaw
          ? parseServiceRouterJson(fallbackParsedRaw, this.parseContext(input))
          : null;
        if (fallbackParsed) {
          return fallbackParsed;
        }
      }

      return parsed;
    }

    if (input.llmRuntime?.skipJsonRepair) {
      return routeServiceFromProfiles(input);
    }

    const repair = await this.client.chat(
      {
        ...request,
        messages: [
          {
            role: 'system',
            content: `${COMPACT_SERVICE_ROUTER_SYSTEM_PROMPT}\nReturn valid JSON only.`,
          },
          { role: 'user', content: primary.content },
        ],
      },
      runtime,
    );

    const repairedRaw = this.client.parseJsonContent<unknown>(repair.content);
    const repaired = repairedRaw
      ? parseServiceRouterJson(repairedRaw, this.parseContext(input))
      : null;
    if (repaired) {
      return repaired;
    }

    return routeServiceFromProfiles(input);
  }
}
