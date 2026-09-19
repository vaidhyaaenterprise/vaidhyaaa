import { type OnApplicationShutdown } from '@nestjs/common';

import { closeDatabaseConnection, type DatabaseConnection } from '@vaidya/db';

export class DatabaseLifecycleService implements OnApplicationShutdown {
  private closePromise: Promise<void> | undefined;

  constructor(private readonly connection: DatabaseConnection) {}

  onApplicationShutdown(): Promise<void> {
    this.closePromise ??= closeDatabaseConnection(this.connection);
    return this.closePromise;
  }
}
