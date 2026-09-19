import { describe, expect, it, vi } from 'vitest';

import { type DatabaseConnection } from '@vaidya/db';

import { DatabaseLifecycleService } from '../src/modules/database/database-lifecycle.service';

describe('DatabaseLifecycleService', () => {
  it('closes the shared client once when the application shuts down', async () => {
    const end = vi.fn().mockResolvedValue(undefined);
    const connection = {
      client: { end },
    } as unknown as DatabaseConnection;
    const service = new DatabaseLifecycleService(connection);

    await Promise.all([service.onApplicationShutdown(), service.onApplicationShutdown()]);

    expect(end).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith({ timeout: 5 });
  });
});
