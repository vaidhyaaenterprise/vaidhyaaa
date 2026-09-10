'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import {
  disableClinicUser,
  enableClinicUser,
  fetchClinicUsers,
  createClinicUserLogin,
  type ClinicUserRow,
} from '@/lib/api/clinic-users';
import { fetchDoctors, type DoctorApiRow } from '@/lib/api/clinic-clinical';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';

type ClinicUser = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: 'admin' | 'receptionist' | 'doctor';
  doctorId: string | null;
  active: boolean;
};

function mapUser(row: ClinicUserRow): ClinicUser {
  const role =
    row.role === 'clinic_admin'
      ? 'admin'
      : row.role === 'doctor'
        ? 'doctor'
        : 'receptionist';
  return {
    id: row.id,
    name: row.user.name ?? 'User',
    email: row.user.email ?? '',
    username: row.user.username ?? null,
    role,
    doctorId: row.doctor_id,
    active: row.active && row.user.active,
  };
}

type NewUserRole = 'doctor' | 'admin';

export function UserManagement() {
  const { effectiveRole } = useAuth();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<ClinicUser[]>([]);
  const [clinicLoginNumber, setClinicLoginNumber] = useState<string | null>(null);

  const [doctors, setDoctors] = useState<DoctorApiRow[]>([]);

  const [newRole, setNewRole] = useState<NewUserRole>('doctor');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDoctorId, setNewDoctorId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdUsername, setCreatedUsername] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    if (!isAdmin || !clinicId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchClinicUsers(clinicId);
      setUsers(data.users.map(mapUser));
      setClinicLoginNumber(data.clinic_login_number ?? null);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.apiError.message : 'Failed to load clinic users.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAdmin, clinicId]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!isAdmin || !clinicId) {
      return;
    }
    void fetchDoctors(clinicId)
      .then(setDoctors)
      .catch(() => setDoctors([]));
  }, [isAdmin, clinicId]);

  const toggleUserActive = async (id: string) => {
    if (!clinicId) {
      return;
    }
    const user = users.find((row) => row.id === id);
    if (!user) {
      return;
    }
    if (user.active) {
      await disableClinicUser(clinicId, id);
    } else {
      await enableClinicUser(clinicId, id);
    }
    await loadUsers();
  };

  const unlinkedDoctors = useMemo(
    () => doctors.filter((doctor) => !doctor.user_id),
    [doctors],
  );

  const previewUsername = useMemo(() => {
    const base =
      newName
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '.')
        .replace(/[^a-zA-Z0-9._-]/g, '')
        .replace(/\.{2,}/g, '.') || 'name';
    const number = clinicLoginNumber ?? '1000';
    return `${base}.${number}`;
  }, [newName, clinicLoginNumber]);

  const canCreate =
    newName.trim().length > 0 &&
    newPassword.length >= 6 &&
    (newRole === 'admin' || newDoctorId.length > 0);

  const resetCreateForm = () => {
    setNewRole('doctor');
    setNewName('');
    setNewPassword('');
    setNewDoctorId('');
    setCreateError(null);
    setCreatedUsername(null);
  };

  const handleCreate = async () => {
    if (!clinicId || !canCreate) {
      return;
    }
    setCreating(true);
    setCreateError(null);
    setCreatedUsername(null);
    try {
      const result = await createClinicUserLogin(clinicId, {
        role: newRole === 'admin' ? 'clinic_admin' : 'doctor',
        login_name: newName,
        password: newPassword,
        ...(newRole === 'doctor' ? { doctor_id: newDoctorId } : {}),
      });
      setCreatedUsername(result.user.username);
      resetCreateForm();
      await loadUsers();
    } catch (err) {
      setCreateError(
        err instanceof ApiRequestError
          ? err.apiError.message
          : 'Failed to create user login.',
      );
    } finally {
      setCreating(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">User management</h3>
        </div>
        <p className="text-sm text-slate-500">Only admins can manage users.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <LoadingState title="Loading users" description="Fetching clinic users from the API." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <ErrorState title="Could not load users" description={error} />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-900">User management</h3>
      </div>

      <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4">
        <p className="text-sm font-bold text-slate-900">Add user</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Create a new login for a doctor or an admin. The username is auto-generated with the
          clinic&apos;s unique number ({clinicLoginNumber ? `name.${clinicLoginNumber}` : 'e.g. name.1000'}) and
          cannot be changed.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {(['doctor', 'admin'] as const).map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => setNewRole(role)}
              className={`rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${
                newRole === role
                  ? 'border-teal-600 bg-teal-700 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300'
              }`}
              aria-pressed={newRole === role}
            >
              {role === 'doctor' ? 'Doctor' : 'Admin'}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="new-user-name">
              Name
            </label>
            <input
              id="new-user-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="e.g. Priya"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="new-user-password">
              Password
            </label>
            <input
              id="new-user-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="At least 6 characters"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500"
            />
          </div>
        </div>

        {newRole === 'doctor' ? (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="new-user-doctor">
              Doctor
            </label>
            <select
              id="new-user-doctor"
              value={newDoctorId}
              onChange={(event) => setNewDoctorId(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500"
            >
              <option value="">Select a doctor</option>
              {unlinkedDoctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </select>
            {unlinkedDoctors.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                All doctors already have a login linked.
              </p>
            ) : null}
          </div>
        ) : null}

        {newName.trim().length > 0 ? (
          <p className="mt-2 text-xs text-slate-600">
            Username preview: <span className="font-bold text-teal-700">{previewUsername}</span>
          </p>
        ) : null}

        {createError ? (
          <p className="mt-2 text-xs font-semibold text-red-600">{createError}</p>
        ) : null}
        {createdUsername ? (
          <p className="mt-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">
            Created! Username: {createdUsername}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={!canCreate || creating}
          className="mt-3 rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create user'}
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {users.map((user) => (
          <div
            key={user.id}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3"
          >
            <div>
              <p className="text-sm font-bold text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
              {user.username ? (
                <p className="text-xs font-semibold text-teal-700">{user.username}</p>
              ) : null}
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {user.role}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void toggleUserActive(user.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                user.active
                  ? 'border border-red-300 bg-red-50 text-red-700'
                  : 'border border-green-300 bg-green-50 text-green-700'
              }`}
            >
              {user.active ? 'Disable' : 'Enable'}
            </button>
          </div>
        ))}
        {users.length === 0 ? (
          <p className="text-sm text-slate-500">No clinic users found.</p>
        ) : null}
      </div>
    </div>
  );
}
