import { type LockService } from '../adapters/index';

export class LockAcquisitionError extends Error {
  constructor(public readonly key: string) {
    super(`Failed to acquire lock: ${key}`);
    this.name = 'LockAcquisitionError';
  }
}

/** Runs `fn` while holding a lock. Always releases on completion or error. */
export async function withLock<T>(
  lockService: LockService,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const acquired = await lockService.acquire(key, ttlMs);
  if (!acquired) {
    throw new LockAcquisitionError(key);
  }

  try {
    return await fn();
  } finally {
    await lockService.release(key);
  }
}
