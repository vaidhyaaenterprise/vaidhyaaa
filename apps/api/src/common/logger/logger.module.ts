import { Global, Module } from '@nestjs/common';

import { API_ENV } from '../../config/api-config.module';
import { type ApiEnv } from '@vaidya/config';

import { AppLogger } from './logger.service';

@Global()
@Module({
  providers: [
    {
      provide: AppLogger,
      useFactory: (env: ApiEnv) => new AppLogger(env),
      inject: [API_ENV],
    },
  ],
  exports: [AppLogger],
})
export class LoggerModule {}
