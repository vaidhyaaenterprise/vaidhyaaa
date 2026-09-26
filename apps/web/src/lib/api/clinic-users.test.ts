import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api/client';
import {
  createClinicUserLogin,
  deleteClinicUserLogin,
  disableClinicUser,
  enableClinicUser,
  fetchClinicUsers,
  updateClinicUserLogin,
} from '@/lib/api/clinic-users';

vi.mock('@/lib/api/client', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}));

const CLINIC_ID = 'clinic-id';
const CLINIC_USER_ID = 'clinic-user-id';

beforeEach(() => {
  vi.mocked(apiDelete).mockReset();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPatch).mockReset();
  vi.mocked(apiPost).mockReset();
});

describe('clinic user API', () => {
  it('uses clinic-scoped read and mutation paths', async () => {
    vi.mocked(apiGet).mockResolvedValue({ users: [], clinic_login_number: '1003' });
    vi.mocked(apiPost).mockResolvedValue({ user: {}, membership: {} });
    vi.mocked(apiPatch).mockResolvedValue({ user: {}, membership: {} });
    vi.mocked(apiDelete).mockResolvedValue({
      revoked: true,
      clinic_user_id: CLINIC_USER_ID,
      credentials_revoked: true,
    });

    await fetchClinicUsers(CLINIC_ID);
    await createClinicUserLogin(CLINIC_ID, {
      role: 'doctor',
      doctor_id: 'doctor-id',
      login_name: 'dr.priya',
      password: 'secret1',
    });
    await updateClinicUserLogin(CLINIC_ID, CLINIC_USER_ID, { login_name: 'priya' });
    await deleteClinicUserLogin(CLINIC_ID, CLINIC_USER_ID);
    await disableClinicUser(CLINIC_ID, CLINIC_USER_ID);
    await enableClinicUser(CLINIC_ID, CLINIC_USER_ID);

    expect(apiGet).toHaveBeenCalledWith(`/v1/clinics/${CLINIC_ID}/users`);
    expect(apiPost).toHaveBeenNthCalledWith(1, `/v1/clinics/${CLINIC_ID}/users`, {
      role: 'doctor',
      doctor_id: 'doctor-id',
      login_name: 'dr.priya',
      password: 'secret1',
    });
    expect(apiPatch).toHaveBeenCalledWith(`/v1/clinics/${CLINIC_ID}/users/${CLINIC_USER_ID}`, {
      login_name: 'priya',
    });
    expect(apiDelete).toHaveBeenCalledWith(`/v1/clinics/${CLINIC_ID}/users/${CLINIC_USER_ID}`);
    expect(apiPost).toHaveBeenNthCalledWith(
      2,
      `/v1/clinics/${CLINIC_ID}/users/${CLINIC_USER_ID}/disable`,
    );
    expect(apiPost).toHaveBeenNthCalledWith(
      3,
      `/v1/clinics/${CLINIC_ID}/users/${CLINIC_USER_ID}/enable`,
    );
  });
});
