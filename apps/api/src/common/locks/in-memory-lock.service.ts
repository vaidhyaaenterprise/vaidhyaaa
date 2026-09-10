import { Injectable } from '@nestjs/common';

import { type LockService } from '@vaidya/shared';

/**
 * Process-local lock service with TTL expiry for development and single-node deployments.
 */
@Injectable()
export class InMemoryLockService implements LockService {
  private readonly locks = new Map<string, number>();

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    this.pruneExpired();
    const now = Date.now();
    const expiresAt = this.locks.get(key);

    if (expiresAt !== undefined && expiresAt > now) {
      return false;
    }

    this.locks.set(key, now + ttlMs);
    return true;
  }

  async release(key: string): Promise<void> {
    this.locks.delete(key);
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.locks.entries()) {
      if (expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }
}

export function sessionLockKey(sessionId: string): string {
  return `conversation:session:${sessionId}`;
}
