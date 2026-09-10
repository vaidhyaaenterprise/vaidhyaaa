import { type ApiEnv } from '@vaidya/config';
import { ADAPTER_TOKENS } from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';
import { LanguagePackService } from '../../modules/conversation/language-pack.service';

import { CompositeStateEntityExtractorAdapter } from './composite-state-entity-extractor.adapter';
import { MockIntentClassifierAdapter } from './mock-intent-classifier.adapter';
import { MockServiceRouterAdapter } from './mock-service-router.adapter';
import { MockStateEntityExtractorAdapter } from './mock-state-entity-extractor.adapter';
import { SarvamIntentClassifierAdapter } from './sarvam-intent-classifier.adapter';
import { SarvamServiceRouterAdapter } from './sarvam-service-router.adapter';
import { SarvamStateEntityExtractorAdapter } from './sarvam-state-entity-extractor.adapter';
import { MockReceptionistDialogPlannerAdapter } from './mock-receptionist-dialog-planner.adapter';
import { SarvamReceptionistDialogPlannerAdapter } from './sarvam-receptionist-dialog-planner.adapter';

export function createIntentClassifierProvider() {
  return {
    provide: ADAPTER_TOKENS.IntentClassifierAdapter,
    useFactory: (env: ApiEnv) => {
      if (env.PRIMARY_LLM_PROVIDER === 'mock') {
        return new MockIntentClassifierAdapter();
      }
      if (env.PRIMARY_LLM_PROVIDER === 'sarvam') {
        return new SarvamIntentClassifierAdapter(env);
      }
      throw new Error(`Unknown PRIMARY_LLM_PROVIDER: ${env.PRIMARY_LLM_PROVIDER}`);
    },
    inject: [API_ENV],
  };
}

export function createServiceRouterProvider() {
  return {
    provide: ADAPTER_TOKENS.ServiceRouterAdapter,
    useFactory: (env: ApiEnv) => {
      if (env.SERVICE_ROUTER_PROVIDER === 'mock') {
        return new MockServiceRouterAdapter();
      }
      if (env.SERVICE_ROUTER_PROVIDER === 'sarvam') {
        return new SarvamServiceRouterAdapter(env);
      }
      throw new Error(`Unknown SERVICE_ROUTER_PROVIDER: ${env.SERVICE_ROUTER_PROVIDER}`);
    },
    inject: [API_ENV],
  };
}

export function createReceptionistDialogPlannerProvider() {
  return {
    provide: ADAPTER_TOKENS.ReceptionistDialogPlannerAdapter,
    useFactory: (env: ApiEnv) => {
      if (env.RECEPTIONIST_DIALOG_PLANNER_PROVIDER === 'mock') {
        return new MockReceptionistDialogPlannerAdapter();
      }
      if (env.RECEPTIONIST_DIALOG_PLANNER_PROVIDER === 'sarvam') {
        return new SarvamReceptionistDialogPlannerAdapter(env);
      }
      throw new Error(
        `Unknown RECEPTIONIST_DIALOG_PLANNER_PROVIDER: ${env.RECEPTIONIST_DIALOG_PLANNER_PROVIDER}`,
      );
    },
    inject: [API_ENV],
  };
}

export function createStateEntityExtractorProvider() {
  return {
    provide: ADAPTER_TOKENS.StateEntityExtractorAdapter,
    useFactory: (env: ApiEnv, languagePackService: LanguagePackService) => {
      if (env.ACTIVE_STATE_INTERPRETER_PROVIDER === 'composite') {
        return new CompositeStateEntityExtractorAdapter(env, languagePackService);
      }
      if (
        env.ACTIVE_STATE_INTERPRETER_PROVIDER === 'mock' ||
        env.STATE_ENTITY_EXTRACTOR_PROVIDER === 'mock'
      ) {
        return new MockStateEntityExtractorAdapter();
      }
      if (
        env.ACTIVE_STATE_INTERPRETER_PROVIDER === 'sarvam' ||
        env.STATE_ENTITY_EXTRACTOR_PROVIDER === 'sarvam'
      ) {
        return new SarvamStateEntityExtractorAdapter(env);
      }
      throw new Error(
        `Unknown active state interpreter provider: ${env.ACTIVE_STATE_INTERPRETER_PROVIDER}`,
      );
    },
    inject: [API_ENV, LanguagePackService],
  };
}
