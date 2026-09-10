import { Global, Module } from '@nestjs/common';

import { type ApiEnv, parseApiEnv } from '@vaidya/config';

export const API_ENV = Symbol('API_ENV');

@Global()
@Module({
  providers: [
    {
      provide: API_ENV,
      useFactory: (): ApiEnv => parseApiEnv(),
    },
  ],
  exports: [API_ENV],
})
export class ApiConfigModule {}
