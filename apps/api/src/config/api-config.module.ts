import { Global, Module } from '@nestjs/common';

import { type ApiEnv, parseApiEnv } from '@vaidya/config';

import { assertVercelDeploymentEnv } from './deployment-env.validator';

export const API_ENV = Symbol('API_ENV');

@Global()
@Module({
  providers: [
    {
      provide: API_ENV,
      useFactory: (): ApiEnv => {
        const env = parseApiEnv();
        if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL) {
          // Build-time validation is useful feedback, but runtime validation is
          // the final guard against a deployment whose environment was changed
          // after it was built (especially a session-pooler DATABASE_URL).
          assertVercelDeploymentEnv(env);
        }
        return env;
      },
    },
  ],
  exports: [API_ENV],
})
export class ApiConfigModule {}
