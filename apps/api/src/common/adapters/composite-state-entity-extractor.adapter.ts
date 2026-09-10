import { Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import {
  attachStateEntityLlmDebug,
  deterministicLlmDebug,
  extractStateEntitiesMockCore,
  languagePackLlmDebug,
  runActiveStatePreflight,
  tryDeterministicActiveStateEntity,
  type StateEntityExtractorAdapter,
  type StateEntityExtractorInput,
  type StateEntityExtractorResult,
} from '@vaidya/shared';

import { LanguagePackService } from '../../modules/conversation/language-pack.service';

import { SarvamStateEntityExtractorAdapter } from './sarvam-state-entity-extractor.adapter';

@Injectable()
export class CompositeStateEntityExtractorAdapter implements StateEntityExtractorAdapter {
  private readonly sarvamAdapter: SarvamStateEntityExtractorAdapter | null;

  constructor(
    private readonly env: ApiEnv,
    private readonly languagePackService: LanguagePackService,
  ) {
    this.sarvamAdapter =
      env.ACTIVE_STATE_LLM_PROVIDER === 'sarvam' ? new SarvamStateEntityExtractorAdapter(env) : null;
  }

  async extract(input: StateEntityExtractorInput): Promise<StateEntityExtractorResult> {
    const pack = await this.languagePackService.getPack(input.languageCode);
    const preflight = runActiveStatePreflight(input, pack);
    if (preflight) {
      const skippedReason =
        preflight.recognizedAs === 'flow_cancel' || preflight.recognizedAs === 'no_rejection'
          ? 'context_sensitive_match'
          : 'language_pack_fast_path';
      const debugProvider =
        skippedReason === 'context_sensitive_match' ? deterministicLlmDebug : languagePackLlmDebug;
      return attachStateEntityLlmDebug(
        preflight,
        debugProvider('state_entity_extractor', preflight as unknown as Record<string, unknown>, skippedReason),
      );
    }

    if (this.env.ACTIVE_STATE_LLM_PROVIDER === 'sarvam' && this.sarvamAdapter) {
      return this.sarvamAdapter.extract(input);
    }

    const deterministic = tryDeterministicActiveStateEntity(input);
    if (deterministic) {
      return attachStateEntityLlmDebug(
        deterministic,
        deterministicLlmDebug(
          'state_entity_extractor',
          deterministic as unknown as Record<string, unknown>,
          'deterministic_preflight',
        ),
      );
    }

    const result = extractStateEntitiesMockCore(input);
    return attachStateEntityLlmDebug(
      result,
      deterministicLlmDebug('state_entity_extractor', result as unknown as Record<string, unknown>, 'mock_core'),
    );
  }
}
