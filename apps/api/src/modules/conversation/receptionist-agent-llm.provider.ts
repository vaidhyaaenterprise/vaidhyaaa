import { type ApiEnv } from '@vaidya/config';
import { AppError } from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';
import {
  createReceptionistAgentLlmClient,
  isAgentModeEnabled,
} from '../../common/llm/receptionist-agent-llm.factory';

import {
  RECEPTIONIST_AGENT_LLM_PORT,
  type ReceptionistAgentLlmPort,
} from './receptionist-agent.types';

export const receptionistAgentLlmProvider = {
  provide: RECEPTIONIST_AGENT_LLM_PORT,
  useFactory: (env: ApiEnv): ReceptionistAgentLlmPort => {
    if (!isAgentModeEnabled(env)) {
      return {
        chat: async () => {
          throw new AppError('INTERNAL_ERROR', 'Receptionist agent LLM is disabled in legacy mode.');
        },
      };
    }
    return createReceptionistAgentLlmClient(env);
  },
  inject: [API_ENV],
};
