import { type ApiEnv } from '@vaidya/config';
import { ADAPTER_TOKENS } from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';

import {
  MockSttProvider,
  MockTelephonyProvider,
  MockTtsProvider,
} from './mock-adapters';

export function createTelephonyProvider() {
  return {
    provide: ADAPTER_TOKENS.TelephonyProvider,
    useFactory: (env: ApiEnv) => {
      if (env.TELEPHONY_PROVIDER === 'mock') {
        return new MockTelephonyProvider();
      }
      throw new Error(
        `TELEPHONY_PROVIDER=${env.TELEPHONY_PROVIDER} is not implemented in A08. Use mock for local/QA.`,
      );
    },
    inject: [API_ENV],
  };
}

export function createSttProvider() {
  return {
    provide: ADAPTER_TOKENS.SttProvider,
    useFactory: (env: ApiEnv) => {
      if (env.STT_PROVIDER === 'mock') {
        return new MockSttProvider();
      }
      throw new Error(`STT_PROVIDER=${env.STT_PROVIDER} is not implemented in A08. Use mock for local/QA.`);
    },
    inject: [API_ENV],
  };
}

export function createTtsProvider() {
  return {
    provide: ADAPTER_TOKENS.TtsProvider,
    useFactory: (env: ApiEnv) => {
      if (env.TTS_PROVIDER === 'mock') {
        return new MockTtsProvider();
      }
      throw new Error(`TTS_PROVIDER=${env.TTS_PROVIDER} is not implemented in A08. Use mock for local/QA.`);
    },
    inject: [API_ENV],
  };
}
