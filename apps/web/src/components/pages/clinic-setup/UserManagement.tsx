'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { DeleteUserLoginModal } from '@/components/pages/clinic-setup/DeleteUserLoginModal';
import {
  UserCredentialModal,
  type EditableClinicLogin,
} from '@/components/pages/clinic-setup/UserCredentialModal';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import { fetchDoctors, type DoctorApiRow } from '@/lib/api/clinic-clinical';
import {
  createClinicUserLogin,
  deleteClinicUserLogin,
  disableClinicUser,
  enableClinicUser,
  fetchClinicUsers,
  updateClinicUserLogin,
  type ClinicUserRow,
  type CreateClinicUserLoginPayload,
  type UpdateClinicUserLoginPayload,
} from '@/lib/api/clinic-users';

type ClinicUser = {
  id: string;
  userId: string;
  name: string;
  email: string;
  username: string | null;
  role: 'admin' | 'doctor';
  doctorId: string | null;
  membershipActive: boolean;
  accountActive: boolean;
};

type CredentialModalState = { kind: 'create' } | { kind: 'edit'; user: EditableClinicLogin } | null;

function mapUser(row: ClinicUserRow): ClinicUser {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.user.name ?? 'Clinic user',
    email: row.user.email ?? '',
    username: row.user.username ?? null,
    role: row.role === 'doctor' ? 'doctor' : 'admin',
    doctorId: row.doctor_id,
    membershipActive: row.active,
    accountActive: row.user.active,
  };
}

function apiMessage(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError
    ? error.apiError.message
    : error instanceof Error
      ? error.message
      : fallback;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'U'
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m4 20 4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
      <path d="m13.8 7.2 3 3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />
    </svg>
  );
}

export function UserManagement() {
  const { effectiveRole, me } = useAuth();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';
  const currentUserId = me?.user.id ?? null;
  const requestSequence = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<ClinicUser[]>([]);
  const [clinicLoginNumber, setClinicLoginNumber] = useState<string | null>(null);
  const [doctors, setDoctors] = useState<DoctorApiRow[]>([]);
  const [credentialModal, setCredentialModal] = useState<CredentialModalState>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClinicUser | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const closeCredentialModal = useCallback(() => setCredentialModal(null), []);
  const closeDeleteModal = useCallback(() => setDeleteTarget(null), []);

  const loadData = useCallback(
    async (showLoading = true) => {
      if (!isAdmin || !clinicId) {
        setLoading(false);
        return;
      }

      const sequence = ++requestSequence.current;
      if (showLoading) {
        setLoading(true);
        setError(null);
      }

      try {
        const [userData, doctorData] = await Promise.all([
          fetchClinicUsers(clinicId),
          fetchDoctors(clinicId),
        ]);
        if (sequence !== requestSequence.current) return;
        setUsers(userData.users.map(mapUser));
        setClinicLoginNumber(
          userData.clinic_login_number === null || userData.clinic_login_number === undefined
            ? null
            : String(userData.clinic_login_number),
        );
        setDoctors(doctorData);
      } catch (loadError) {
        if (sequence !== requestSequence.current) return;
        const message = apiMessage(loadError, 'Failed to load clinic users.');
        if (showLoading) setError(message);
        else setActionError(message);
      } finally {
        if (showLoading && sequence === requestSequence.current) setLoading(false);
      }
    },
    [clinicId, isAdmin],
  );

  useEffect(() => {
    void loadData();
    return () => {
      requestSequence.current += 1;
    };
  }, [loadData]);

  const sortedUsers = useMemo(
    () =>
      [...users].sort((left, right) => {
        if (left.role !== right.role) return left.role === 'admin' ? -1 : 1;
        if (left.membershipActive !== right.membershipActive) return left.membershipActive ? -1 : 1;
        return left.name.localeCompare(right.name);
      }),
    [users],
  );

  const availableDoctors = useMemo(() => {
    const linkedDoctorIds = new Set(
      users
        .map((user) => user.doctorId)
        .filter((doctorId): doctorId is string => Boolean(doctorId)),
    );
    return doctors.filter(
      (doctor) => doctor.active && !doctor.user_id && !linkedDoctorIds.has(doctor.id),
    );
  }, [doctors, users]);
  const activeAdminCount = useMemo(
    () =>
      users.filter((user) => user.role === 'admin' && user.membershipActive && user.accountActive)
        .length,
    [users],
  );
  const activeCount = useMemo(
    () => users.filter((user) => user.membershipActive && user.accountActive).length,
    [users],
  );

  const refreshAfterMutation = async () => {
    setActionError(null);
    await loadData(false);
  };

  const handleCreate = async (payload: CreateClinicUserLoginPayload) => {
    if (!clinicId) throw new Error('Clinic context is unavailable.');
    try {
      const result = await createClinicUserLogin(clinicId, payload);
      await refreshAfterMutation();
      return { username: result.user.username ?? '' };
    } catch (createError) {
      throw new Error(apiMessage(createError, 'The login could not be created.'));
    }
  };

  const handleUpdate = async (clinicUserId: string, payload: UpdateClinicUserLoginPayload) => {
    if (!clinicId) throw new Error('Clinic context is unavailable.');
    try {
      const result = await updateClinicUserLogin(clinicId, clinicUserId, payload);
      await refreshAfterMutation();
      return { username: result.user.username ?? '' };
    } catch (updateError) {
      throw new Error(apiMessage(updateError, 'The credentials could not be updated.'));
    }
  };

  const handleDelete = async (user: ClinicUser) => {
    if (!clinicId) throw new Error('Clinic context is unavailable.');
    try {
      await deleteClinicUserLogin(clinicId, user.id);
      await refreshAfterMutation();
    } catch (deleteError) {
      throw new Error(apiMessage(deleteError, 'The login could not be deleted.'));
    }
  };

  const toggleUserActive = async (user: ClinicUser) => {
    if (!clinicId || updatingUserId) return;
    setUpdatingUserId(user.id);
    setActionError(null);
    try {
      if (user.membershipActive) await disableClinicUser(clinicId, user.id);
      else await enableClinicUser(clinicId, user.id);
      await refreshAfterMutation();
    } catch (toggleError) {
      setActionError(apiMessage(toggleError, 'Failed to update clinic access.'));
    } finally {
      setUpdatingUserId(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900">User management</h3>
        <p className="mt-2 text-sm text-slate-500">Only clinic administrators can manage logins.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <LoadingState title="Loading logins" description="Fetching secure clinic access." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <ErrorState title="Could not load logins" description={error} />
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-gradient-to-br from-white via-white to-teal-50/60 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-xl font-extrabold tracking-tight text-slate-950">
              User management
            </h3>
            <p className="mt-1 max-w-lg text-sm leading-5 text-slate-500">
              Create and manage secure logins for doctors and clinic administrators.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setCredentialModal({ kind: 'create' });
            }}
            disabled={!clinicLoginNumber}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-teal-700/20 transition hover:-translate-y-0.5 hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            <span className="h-4 w-4">
              <PlusIcon />
            </span>
            Add login
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5">
            <p className="text-lg font-extrabold text-slate-950">{users.length}</p>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Logins</p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5">
            <p className="text-lg font-extrabold text-emerald-700">{activeCount}</p>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active</p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5">
            <p className="text-lg font-extrabold text-teal-700">#{clinicLoginNumber ?? '—'}</p>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Clinic ID
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {actionError ? (
          <div
            role="alert"
            className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
          >
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-xs font-extrabold uppercase tracking-wide"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="space-y-3">
          {sortedUsers.map((user) => {
            const isCurrentUser = user.userId === currentUserId;
            const isLastActiveAdmin =
              user.role === 'admin' &&
              user.membershipActive &&
              user.accountActive &&
              activeAdminCount <= 1;
            const protectsAccess = isCurrentUser || isLastActiveAdmin;
            const active = user.membershipActive && user.accountActive;

            return (
              <article
                key={user.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-[0_10px_30px_rgba(15,23,42,0.06)]"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-extrabold ${user.role === 'doctor' ? 'bg-teal-100 text-teal-800' : 'bg-indigo-100 text-indigo-800'}`}
                  >
                    {initials(user.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-extrabold text-slate-950">{user.name}</p>
                      {isCurrentUser ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-600">
                          You
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${active ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'}`}
                      >
                        {active
                          ? 'Active'
                          : user.accountActive
                            ? 'Access paused'
                            : 'Account disabled'}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs font-bold text-teal-700">
                      {user.username ?? 'Username not configured'}
                    </p>
                    <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                      {user.role === 'admin' ? 'Clinic admin' : 'Doctor login'}
                      {user.email ? ` · ${user.email}` : ''}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    aria-label={`Edit credentials for ${user.username ?? user.name}`}
                    onClick={() =>
                      setCredentialModal({
                        kind: 'edit',
                        user: {
                          id: user.id,
                          name: user.name,
                          username: user.username ?? '',
                          role: user.role,
                          doctorId: user.doctorId,
                        },
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800"
                  >
                    <span className="h-3.5 w-3.5">
                      <EditIcon />
                    </span>
                    Edit credentials
                  </button>
                  <button
                    type="button"
                    aria-label={`${user.membershipActive ? 'Pause' : 'Restore'} access for ${user.username ?? user.name}`}
                    onClick={() => void toggleUserActive(user)}
                    disabled={
                      updatingUserId !== null ||
                      (user.membershipActive && protectsAccess) ||
                      (!user.membershipActive && !user.accountActive)
                    }
                    title={
                      protectsAccess && user.membershipActive
                        ? isCurrentUser
                          ? 'You cannot disable your own login.'
                          : 'At least one active clinic admin is required.'
                        : !user.membershipActive && !user.accountActive
                          ? 'This account is disabled at platform level.'
                          : undefined
                    }
                    className={`rounded-lg border px-3 py-1.5 text-xs font-extrabold transition disabled:cursor-not-allowed disabled:opacity-45 ${user.membershipActive ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                  >
                    {updatingUserId === user.id
                      ? 'Updating…'
                      : user.membershipActive
                        ? 'Pause access'
                        : 'Restore access'}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete login for ${user.username ?? user.name}`}
                    onClick={() => setDeleteTarget(user)}
                    disabled={protectsAccess}
                    title={
                      protectsAccess
                        ? isCurrentUser
                          ? 'You cannot delete your own login.'
                          : 'At least one active clinic admin is required.'
                        : undefined
                    }
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-extrabold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="h-3.5 w-3.5">
                      <TrashIcon />
                    </span>
                    Delete login
                  </button>
                </div>
              </article>
            );
          })}

          {sortedUsers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
              <p className="text-sm font-extrabold text-slate-800">No clinic logins yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Add a doctor or clinic-admin login to get started.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {credentialModal && clinicLoginNumber ? (
        <UserCredentialModal
          clinicLoginNumber={clinicLoginNumber}
          doctors={availableDoctors}
          editingUser={credentialModal.kind === 'edit' ? credentialModal.user : null}
          onClose={closeCredentialModal}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteUserLoginModal
          name={deleteTarget.name}
          username={deleteTarget.username ?? 'unconfigured login'}
          role={deleteTarget.role}
          onClose={closeDeleteModal}
          onConfirm={() => handleDelete(deleteTarget)}
        />
      ) : null}
    </section>
  );
}
