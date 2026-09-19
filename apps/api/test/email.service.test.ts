import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseApiEnv } from '@vaidya/config';

const { resendSend } = vi.hoisted(() => ({ resendSend: vi.fn() }));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

import { EmailService } from '../src/modules/email/email.service';

function createEmailService(timeoutMs = 50): EmailService {
  const env = parseApiEnv({
    NODE_ENV: 'test',
    APP_ENV: 'local',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
    JWT_SECRET: 'test-secret',
    AUTH_MODE: 'dev',
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'Vaidya <noreply@example.test>',
    EMAIL_PROVIDER_TIMEOUT_MS: String(timeoutMs),
  });
  return new EmailService(env);
}

describe('EmailService provider reliability', () => {
  beforeEach(() => {
    resendSend.mockReset();
  });

  it('uses a stable idempotency key for the same email', async () => {
    resendSend.mockResolvedValue({ data: { id: 'email-id' }, error: null });
    const service = createEmailService();

    await service.sendVerificationCode('patient@example.test', '123456');
    await service.sendVerificationCode('patient@example.test', '123456');

    const firstOptions = resendSend.mock.calls[0]?.[1] as { idempotencyKey?: string };
    const secondOptions = resendSend.mock.calls[1]?.[1] as { idempotencyKey?: string };
    expect(firstOptions.idempotencyKey).toMatch(/^vaidya-email-[a-f0-9]{64}$/);
    expect(secondOptions.idempotencyKey).toBe(firstOptions.idempotencyKey);
  });

  it('fails within the configured provider timeout', async () => {
    resendSend.mockReturnValue(new Promise(() => undefined));
    const service = createEmailService(5);

    await expect(
      service.sendPasswordResetCode('patient@example.test', '123456'),
    ).rejects.toMatchObject({ code: 'PROVIDER_FAILURE' });

    const requestOptions = resendSend.mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(requestOptions.signal).toBeInstanceOf(AbortSignal);
    expect(requestOptions.signal?.aborted).toBe(true);
  });
});
