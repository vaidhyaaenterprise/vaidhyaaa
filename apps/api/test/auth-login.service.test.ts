import { describe, expect, it, vi } from 'vitest';

import { type ApiEnv } from '@vaidya/config';
import { type DatabaseConnection, type DatabaseService, type Repositories } from '@vaidya/db';

import { hashPassword } from '../src/common/crypto/password';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import type { ClinicRegistrationService } from '../src/modules/auth/clinic-registration.service';
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
    expect(findUserByUsernameOrEmail).toHaveBeenCalledWith('admin', undefined);
    expect(touchUserLastLogin).toHaveBeenCalledOnce();
    expect(listActiveClinicMemberships).toHaveBeenCalledOnce();
  });

  it('rejects an explicitly requested clinic outside the user memberships', async () => {
    const now = new Date('2026-09-20T12:00:00.000Z');
    const userId = '00000000-0000-4000-8000-000000000101';
    const user = {
      id: userId,
      platformRole: null,
      active: true,
    };
    const membership = {
      id: '00000000-0000-4000-8000-000000000201',
      clinicId: '00000000-0000-4000-8000-000000000301',
      userId,
      role: 'clinic_admin',
      doctorId: null,
      active: true,
      invitedByUserId: null,
      deletedAt: null,
      deletedByUserId: null,
      createdAt: now,
      updatedAt: now,
    };

    const service = new AuthService(
      { db: {} } as unknown as DatabaseConnection,
      {} as DatabaseService,
      { JWT_SECRET: 'test-secret' } as ApiEnv,
      {} as EmailService,
    );
    (service as unknown as { repos: Repositories }).repos = {
      auth: {
        findUserById: vi.fn().mockResolvedValue([user]),
        listActiveClinicMemberships: vi.fn().mockResolvedValue([membership]),
      },
    } as unknown as Repositories;

    await expect(
      service.resolveAuthContext({
        userId,
        clinicId: '00000000-0000-4000-8000-000000000999',
      }),
    ).rejects.toThrow('Requested clinic membership was not found.');
  });
});

describe('role-specific password sessions', () => {
  const password = 'shared-test-password';
  const fields = hashPassword(password);
  const user = {
    id: '00000000-0000-4000-8000-000000000101',
    name: 'Shared Login',
    email: 'shared@example.test',
    phone: null,
    platformRole: null,
    active: true,
    passwordHash: fields.hash,
    passwordSalt: fields.salt,
  };
  const admin = {
    clinicId: '00000000-0000-4000-8000-000000000301',
    role: 'clinic_admin',
    doctorId: null,
    active: true,
  };
  const doctor = {
    clinicId: '00000000-0000-4000-8000-000000000302',
    role: 'doctor',
    doctorId: '00000000-0000-4000-8000-000000000401',
    active: true,
  };

  function setup(memberships = [admin, doctor]) {
    const auth = {
      findUserByUsernameOrEmail: vi.fn().mockResolvedValue([user]),
      findUserById: vi.fn().mockResolvedValue([user]),
      listActiveClinicMemberships: vi.fn().mockResolvedValue(memberships),
      touchUserLastLogin: vi.fn().mockResolvedValue([]),
    };
    const service = new AuthService(
      { db: {} } as unknown as DatabaseConnection,
      {} as DatabaseService,
      { JWT_SECRET: 'test-secret' } as ApiEnv,
      {} as EmailService,
    );
    (service as unknown as { repos: Repositories }).repos = { auth } as unknown as Repositories;
    return { service, auth };
  }

  it.each(['doctor', 'clinic_admin'] as const)(
    'preserves the selected %s role in the login response, bearer authentication and /me',
    async (role) => {
      const { service, auth } = setup();
      const membership = role === 'doctor' ? doctor : admin;
      const result = await service.loginWithUsernamePassword(
        ' SHARED@example.test ',
        password,
        role,
      );
      expect(auth.findUserByUsernameOrEmail).toHaveBeenCalledWith('shared@example.test', role);
      expect(result.clinics).toEqual([
        {
          clinic_id: membership.clinicId,
          role,
          doctor_id: membership.doctorId,
          active: true,
        },
      ]);
      const context = await service.authenticateBearerToken(result.access_token);
      expect(context).toMatchObject({
        userId: user.id,
        clinicId: membership.clinicId,
        clinicRole: role,
        doctorId: membership.doctorId ?? undefined,
      });
      expect((await service.getMe(context)).clinics).toEqual(result.clinics);
    },
  );

  it('does not sign an admin-only account in as a doctor', async () => {
    const { service, auth } = setup([admin]);
    await expect(service.loginWithUsernamePassword(user.email, password, 'doctor')).rejects.toThrow(
      'no active membership for the selected role',
    );
    expect(auth.touchUserLastLogin).not.toHaveBeenCalled();
  });

  it('does not sign a doctor-only account in as an admin', async () => {
    const { service } = setup([doctor]);
    await expect(
      service.loginWithUsernamePassword(user.email, password, 'clinic_admin'),
    ).rejects.toThrow('no active membership for the selected role');
  });

  it('requires a linked doctor profile for doctor sign-in', async () => {
    const { service } = setup([{ ...doctor, doctorId: null }]);
    await expect(service.loginWithUsernamePassword(user.email, password, 'doctor')).rejects.toThrow(
      'Doctor profile is not linked',
    );
  });

  it('does not fall back to admin access after doctor membership is revoked', async () => {
    const { service, auth } = setup();
    const result = await service.loginWithUsernamePassword(user.email, password, 'doctor');
    auth.listActiveClinicMemberships.mockResolvedValue([admin]);
    await expect(service.authenticateBearerToken(result.access_token)).rejects.toThrow(
      'Requested clinic membership was not found',
    );
  });

  it('still validates the password when the requested role exists', async () => {
    const { service, auth } = setup();
    await expect(service.loginWithUsernamePassword(user.email, 'wrong', 'doctor')).rejects.toThrow(
      'Invalid username or password',
    );
    expect(auth.touchUserLastLogin).not.toHaveBeenCalled();
  });

  it('accepts existing tokens without role claims', async () => {
    const { service } = setup([doctor]);
    await expect(
      service.authenticateBearerToken(service.createAccessToken(user.id)),
    ).resolves.toMatchObject({
      userId: user.id,
      clinicRole: 'doctor',
      doctorId: doctor.doctorId,
    });
  });

  it('rejects a token whose selected role has been tampered with', async () => {
    const { service } = setup();
    const result = await service.loginWithUsernamePassword(user.email, password, 'doctor');
    const [encodedPayload, signature] = result.access_token.split('.');
    if (!encodedPayload || !signature) throw new Error('Expected a signed token');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
    payload.clinicRole = 'clinic_admin';
    const tamperedToken = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
    await expect(service.authenticateBearerToken(tamperedToken)).rejects.toThrow(
      'Invalid access token',
    );
  });
});

describe('password login endpoint', () => {
  it('passes the selected role from the validated request to authentication', async () => {
    const login = vi.fn().mockResolvedValue({ access_token: 'test-token' });
    const controller = new AuthController(
      { loginWithUsernamePassword: login } as unknown as AuthService,
      {} as ClinicRegistrationService,
    );
    await controller.loginWithUsernamePassword({
      username: 'shared@example.test',
      password: 'test-password',
      role: 'doctor',
    });
    expect(login).toHaveBeenCalledWith('shared@example.test', 'test-password', 'doctor');
    await expect(
      controller.loginWithUsernamePassword({
        username: 'shared@example.test',
        password: 'test-password',
        role: 'platform_admin',
      }),
    ).rejects.toThrow('Invalid login payload');
    expect(login).toHaveBeenCalledOnce();
  });
});
