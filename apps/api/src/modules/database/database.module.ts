import { Global, Module } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import {
  createDatabaseConnection,
  createRepositories,
  DatabaseService,
  type DatabaseConnection,
} from '@vaidya/db';

import { API_ENV } from '../../config/api-config.module';

export const DATABASE_CONNECTION = Symbol('DATABASE_CONNECTION');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      useFactory: (env: ApiEnv): DatabaseConnection => createDatabaseConnection(env.DATABASE_URL),
      inject: [API_ENV],
    },
    {
      provide: DatabaseService,
      useFactory: (connection: DatabaseConnection) => new DatabaseService(connection.db),
      inject: [DATABASE_CONNECTION],
    },
    {
      provide: 'REPOSITORIES',
      useFactory: (connection: DatabaseConnection) => createRepositories(connection.db),
      inject: [DATABASE_CONNECTION],
    },
  ],
  exports: [DATABASE_CONNECTION, DatabaseService, 'REPOSITORIES'],
})
export class DatabaseModule {}
