import { describe, expect, it, vi } from 'vitest';

import { loginWithUsernamePassword } from './auth';

import { apiPost } from '@/lib/api/client';

vi.mock('@/lib/api/client', () => ({ apiPost: vi.fn() }));

describe('password login API', () => {
  it('includes the chosen role in the request body', async () => {
    await loginWithUsernamePassword('shared@example.test', 'test-password', 'doctor');
    expect(apiPost).toHaveBeenCalledWith(
      '/v1/auth/login',
      { username: 'shared@example.test', password: 'test-password', role: 'doctor' },
      { retryTransient: true },
    );
  });
});
