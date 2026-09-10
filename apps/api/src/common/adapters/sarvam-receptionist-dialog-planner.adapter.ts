import { Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import {
  buildReceptionistDialogUserPayload,
  parseReceptionistDialogPlanFromContent,
  RECEPTIONIST_DIALOG_SYSTEM_PROMPT,
  type ReceptionistDialogPlannerAdapter,
  type ReceptionistDialogInput,
  type ReceptionistDialogPlan,
} from '@vaidya/shared';

import { SarvamLlmClient } from '../llm/sarvam-client';

@Injectable()
export class SarvamReceptionistDialogPlannerAdapter implements ReceptionistDialogPlannerAdapter {
  private readonly client: SarvamLlmClient;

  constructor(private readonly env: ApiEnv) {
    this.client = SarvamLlmClient.fromEnv(env);
  }

  async plan(input: ReceptionistDialogInput): Promise<ReceptionistDialogPlan | null> {
    if (!this.env.SARVAM_API_KEY) {
      return null;
    }

    const userPayload = buildReceptionistDialogUserPayload(input);
    const messages = [
      { role: 'system' as const, content: RECEPTIONIST_DIALOG_SYSTEM_PROMPT },
      { role: 'user' as const, content: JSON.stringify(userPayload) },
    ];

    try {
      const primary = await this.client.chat(
        {
          model: this.env.RECEPTIONIST_DIALOG_PLANNER_MODEL,
          messages,
          responseFormat: 'json_object',
          temperature: 0,
          maxTokens: 900,
        },
        { timeoutMs: this.env.RECEPTIONIST_DIALOG_PLANNER_TIMEOUT_MS },
      );

      const parsed = parseReceptionistDialogPlanFromContent(primary.content);
      if (parsed) {
        return parsed;
      }

      if (this.env.RECEPTIONIST_DIALOG_PLANNER_ENABLE_FALLBACK) {
        const fallback = await this.client.chat(
          {
            model: this.env.RECEPTIONIST_DIALOG_PLANNER_FALLBACK_MODEL,
            messages: [
              { role: 'system', content: `${RECEPTIONIST_DIALOG_SYSTEM_PROMPT}\nReturn valid JSON only.` },
              { role: 'user', content: JSON.stringify(userPayload) },
            ],
            responseFormat: 'json_object',
            temperature: 0,
            maxTokens: 900,
          },
          { timeoutMs: this.env.RECEPTIONIST_DIALOG_PLANNER_TIMEOUT_MS },
        );
        const fallbackParsed = parseReceptionistDialogPlanFromContent(fallback.content);
        if (fallbackParsed) {
          return fallbackParsed;
        }
      }
    } catch {
      return null;
    }

    return null;
  }
}
