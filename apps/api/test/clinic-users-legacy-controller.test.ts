import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { AuthContext } from '@vaidya/shared';

import { DEV_AUTH_HEADERS } from '../src/common/constants/auth.constants';
import { AUTH_CONTEXT_KEY } from '../src/common/guards/auth.guard';
import { ClinicUsersLegacyController } from '../src/modules/clinic-setup/clinic-setup.controller';
import type { ClinicUsersService } from '../src/modules/clinic-setup/clinic-users.service';

const AUTHENTICATED_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const SPOOFED_CLINIC_ID = '00000000-0000-0000-0000-000000000002';
const USER_ID = '00000000-0000-0000-0000-000000000101';

function requestWithAuth(
  auth: AuthContext,
  headerClinicId?: string,
): FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext } {
  return {
    headers: headerClinicId ? { [DEV_AUTH_HEADERS.CLINIC_ID]: headerClinicId } : {},
    [AUTH_CONTEXT_KEY]: auth,
  } as FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext };
}

describe('ClinicUsersLegacyController tenant isolation', () => {
  it('ignores a spoofed clinic header for a clinic-scoped administrator', async () => {
    const listUsers = vi.fn().mockResolvedValue({ users: [], clinicLoginNumber: 1003 });
    const controller = new ClinicUsersLegacyController({
      listUsers,
    } as unknown as ClinicUsersService);

    await controller.listUsers(
      requestWithAuth(
        {
          userId: USER_ID,
          clinicId: AUTHENTICATED_CLINIC_ID,
          clinicRole: 'clinic_admin',
        },
        SPOOFED_CLINIC_ID,
      ),
    );

    expect(listUsers).toHaveBeenCalledWith(AUTHENTICATED_CLINIC_ID);
  });

  it('uses the authenticated clinic for every legacy write operation', async () => {
    const inviteUser = vi.fn().mockResolvedValue({ user: {}, membership: {} });
    const setMembershipActive = vi.fn().mockResolvedValue({});
    const controller = new ClinicUsersLegacyController({
      inviteUser,
      setMembershipActive,
    } as unknown as ClinicUsersService);
    const request = requestWithAuth(
      {
        userId: USER_ID,
        clinicId: AUTHENTICATED_CLINIC_ID,
        clinicRole: 'clinic_admin',
      },
      SPOOFED_CLINIC_ID,
    );

    await controller.inviteUser(
      {
        role: 'clinic_admin',
        name: 'Second Admin',
        email: 'second.admin@example.test',
      },
      request,
    );
    await controller.disableUser('00000000-0000-0000-0000-000000000111', request);
    await controller.enableUser('00000000-0000-0000-0000-000000000111', request);

    expect(inviteUser).toHaveBeenCalledWith(
      AUTHENTICATED_CLINIC_ID,
      expect.objectContaining({ role: 'clinic_admin' }),
      USER_ID,
    );
    expect(setMembershipActive).toHaveBeenNthCalledWith(
      1,
      AUTHENTICATED_CLINIC_ID,
      '00000000-0000-0000-0000-000000000111',
      false,
      USER_ID,
    );
    expect(setMembershipActive).toHaveBeenNthCalledWith(
      2,
      AUTHENTICATED_CLINIC_ID,
      '00000000-0000-0000-0000-000000000111',
      true,
      USER_ID,
    );
  });

  it('uses only a platform administrator clinic context already resolved by authentication', async () => {
    const listUsers = vi.fn().mockResolvedValue({ users: [], clinicLoginNumber: 1004 });
    const controller = new ClinicUsersLegacyController({
      listUsers,
    } as unknown as ClinicUsersService);

    await controller.listUsers(
      requestWithAuth(
        { userId: USER_ID, platformRole: 'platform_admin', clinicId: SPOOFED_CLINIC_ID },
        AUTHENTICATED_CLINIC_ID,
      ),
    );

    expect(listUsers).toHaveBeenCalledWith(SPOOFED_CLINIC_ID);
  });
});
