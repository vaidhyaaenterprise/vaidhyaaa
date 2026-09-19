import { describe, expect, it, vi } from 'vitest';

import { type ApiEnv } from '@vaidya/config';
import { type DatabaseConnection, type DatabaseService, type Repositories } from '@vaidya/db';

import { hashPassword } from '../src/common/crypto/password';
import { AuthService } from '../src/modules/auth/auth.service';
import { type EmailService } from '../src/modules/email/email.service';

describe('AuthService password login', () => {
  it('loads the authenticated user and memberships only once', async () => {
    const password = 'validPassword123';
    const passwordFields = hashPassword(password);
    const now = new Date('2026-09-20T12:00:00.000Z');
    const user = {
      id: '00000000-0000-4000-8000-000000000101',
      authProviderId: null,
      name: 'Clinic Admin',
      email: 'admin@example.test',
      phone: null,
      username: 'admin',
      passwordHash: passwordFields.hash,
      passwordSalt: passwordFields.salt,
      platformRole: null,
      active: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const membership = {
      id: '00000000-0000-4000-8000-000000000201',
      clinicId: '00000000-0000-4000-8000-000000000301',
      userId: user.id,
      role: 'clinic_admin',
      doctorId: null,
      active: true,
      invitedByUserId: null,
      createdAt: now,
      updatedAt: now,
    };
    const findUserByUsernameOrEmail = vi.fn().mockResolvedValue([user]);
    const touchUserLastLogin = vi.fn().mockResolvedValue([]);
    const listActiveClinicMemberships = vi.fn().mockResolvedValue([membership]);

    const service = new AuthService(
      { db: {} } as unknown as DatabaseConnection,
      {} as DatabaseService,
      { JWT_SECRET: 'test-secret' } as ApiEnv,
      {} as EmailService,
    );
    (service as unknown as { repos: Repositories }).repos = {
      auth: {
        findUserByUsernameOrEmail,
        touchUserLastLogin,
        listActiveClinicMemberships,
      },
    } as unknown as Repositories;

    await expect(service.loginWithUsernamePassword(' ADMIN ', password)).resolves.toMatchObject({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        platform_role: null,
      },
      clinics: [
        {
          clinic_id: membership.clinicId,
          role: 'clinic_admin',
          doctor_id: null,
          active: true,
        },
      ],
      access_token: expect.any(String),
    });
    expect(findUserByUsernameOrEmail).toHaveBeenCalledOnce();
    expect(findUserByUsernameOrEmail).toHaveBeenCalledWith('admin');
    expect(touchUserLastLogin).toHaveBeenCalledOnce();
    expect(listActiveClinicMemberships).toHaveBeenCalledOnce();
  });
});
