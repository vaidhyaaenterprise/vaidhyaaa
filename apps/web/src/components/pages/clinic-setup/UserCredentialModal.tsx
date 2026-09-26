'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';

import type { DoctorApiRow } from '@/lib/api/clinic-clinical';
import type {
  CreateClinicUserLoginPayload,
  UpdateClinicUserLoginPayload,
} from '@/lib/api/clinic-users';

import {
  composeClinicUsername,
  extractLoginPrefix,
  normalizeLoginPrefix,
} from './user-login-credentials';

export type EditableClinicLogin = {
  id: string;
  name: string;
  username: string;
  role: 'admin' | 'doctor';
  doctorId: string | null;
};

type CreatedCredentials = {
  username: string;
  password: string;
};

type UserCredentialModalProps = {
  clinicLoginNumber: string;
  doctors: DoctorApiRow[];
  editingUser?: EditableClinicLogin | null;
  onClose: () => void;
  onCreate: (payload: CreateClinicUserLoginPayload) => Promise<{ username: string }>;
  onUpdate: (
    clinicUserId: string,
    payload: UpdateClinicUserLoginPayload,
  ) => Promise<{ username: string }>;
};

const inputClassName =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';
const labelClassName = 'mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500';

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m3 3 18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.3A10.8 10.8 0 0 1 12 4c5.5 0 9 6 9 6a17 17 0 0 1-2.1 2.8M6.6 6.6C4.3 8.1 3 10 3 10s3.5 6 9 6c1 0 1.9-.2 2.8-.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function UserCredentialModal({
  clinicLoginNumber,
  doctors,
  editingUser = null,
  onClose,
  onCreate,
  onUpdate,
}: UserCredentialModalProps) {
  const isEditing = Boolean(editingUser);
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const prefixInputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [role, setRole] = useState<'doctor' | 'admin'>(editingUser?.role ?? 'doctor');
  const [doctorId, setDoctorId] = useState(editingUser?.doctorId ?? '');
  const [loginPrefix, setLoginPrefix] = useState(() =>
    extractLoginPrefix(editingUser?.username ?? null, clinicLoginNumber),
  );
  const [prefixWasEdited, setPrefixWasEdited] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<CreatedCredentials | null>(null);
  const [copiedField, setCopiedField] = useState<'username' | 'password' | null>(null);

  const normalizedPrefix = useMemo(() => normalizeLoginPrefix(loginPrefix), [loginPrefix]);
  const previewUsername = useMemo(
    () => composeClinicUsername(normalizedPrefix, clinicLoginNumber),
    [clinicLoginNumber, normalizedPrefix],
  );
  const originalPrefix = useMemo(
    () => extractLoginPrefix(editingUser?.username ?? null, clinicLoginNumber),
    [clinicLoginNumber, editingUser?.username],
  );
  const passwordMatches = password === confirmPassword;
  const passwordLongEnough = password.length >= 6;
  const usernameChanged = isEditing && normalizedPrefix !== originalPrefix;
  const passwordChanged = isEditing && password.length > 0;
  const canSubmit = isEditing
    ? normalizedPrefix.length > 0 &&
      (usernameChanged || passwordChanged) &&
      (!passwordChanged || (passwordLongEnough && passwordMatches))
    : normalizedPrefix.length > 0 &&
      Boolean(clinicLoginNumber) &&
      (role === 'admin' || Boolean(doctorId)) &&
      passwordLongEnough &&
      passwordMatches;

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    prefixInputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const selectDoctor = (nextDoctorId: string) => {
    setDoctorId(nextDoctorId);
    setError(null);
    if (!prefixWasEdited) {
      const doctor = doctors.find((row) => row.id === nextDoctorId);
      setLoginPrefix(doctor ? normalizeLoginPrefix(doctor.name) : '');
    }
  };

  const selectRole = (nextRole: 'doctor' | 'admin') => {
    setRole(nextRole);
    setDoctorId('');
    setLoginPrefix('');
    setPrefixWasEdited(false);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitAttempted(true);
    setError(null);
    if (!canSubmit || submitting) {
      return;
    }

    busyRef.current = true;
    setSubmitting(true);
    try {
      if (editingUser) {
        const patch: UpdateClinicUserLoginPayload = {};
        if (usernameChanged) {
          patch.login_name = normalizedPrefix;
        }
        if (passwordChanged) {
          patch.password = password;
        }
        await onUpdate(editingUser.id, patch);
        setPassword('');
        setConfirmPassword('');
        onClose();
      } else {
        const result = await onCreate({
          role: role === 'admin' ? 'clinic_admin' : 'doctor',
          login_name: normalizedPrefix,
          password,
          ...(role === 'doctor' ? { doctor_id: doctorId } : {}),
        });
        setCreatedCredentials({ username: result.username, password });
        setPassword('');
        setConfirmPassword('');
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'The login could not be saved.',
      );
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  };

  const copyValue = async (field: 'username' | 'password', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1_500);
    } catch {
      setError('Copy is unavailable in this browser. Select and copy the value manually.');
    }
  };

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-[28px] border border-white/70 bg-white text-slate-900 shadow-[0_28px_90px_rgba(15,23,42,0.35)]"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5 sm:px-7">
          <div>
            <p className="mb-1 text-xs font-extrabold uppercase tracking-[0.18em] text-teal-700">
              Secure clinic access
            </p>
            <h2 id={titleId} className="text-xl font-extrabold tracking-tight text-slate-950">
              {createdCredentials
                ? 'Login created successfully'
                : isEditing
                  ? 'Edit login credentials'
                  : 'Add a new login'}
            </h2>
            <p id={descriptionId} className="mt-1 text-sm leading-5 text-slate-500">
              {createdCredentials
                ? 'Share these credentials securely. The password is shown only this time.'
                : isEditing
                  ? `Update access for ${editingUser?.name ?? 'this user'}.`
                  : 'Create secure access for a doctor or another clinic administrator.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="ml-4 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-50"
            aria-label="Close login dialog"
          >
            <span className="h-5 w-5">
              <CloseIcon />
            </span>
          </button>
        </div>

        {createdCredentials ? (
          <div className="p-6 sm:p-7">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
              <p className="text-sm font-bold text-emerald-900">Credentials ready</p>
              <p className="mt-1 text-xs leading-5 text-emerald-800">
                Ask the user to sign in and change the temporary password through the password reset
                flow. It cannot be viewed again after this window is closed.
              </p>
            </div>

            {(['username', 'password'] as const).map((field) => {
              const value = createdCredentials[field];
              return (
                <div key={field} className="mt-4">
                  <p className={labelClassName}>{field}</p>
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 pl-4">
                    <code className="min-w-0 flex-1 break-all text-sm font-bold text-slate-900">
                      {value}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyValue(field, value)}
                      className="flex shrink-0 items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-teal-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-teal-50"
                    >
                      <span className="h-4 w-4">
                        <CopyIcon />
                      </span>
                      {copiedField === field ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              );
            })}

            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
              >
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full rounded-xl bg-teal-700 px-4 py-3 text-sm font-extrabold text-white shadow-lg shadow-teal-700/20 transition hover:bg-teal-800"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)} className="p-6 sm:p-7">
            {!isEditing ? (
              <div>
                <span className={labelClassName}>Login type</span>
                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5">
                  {(['doctor', 'admin'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => selectRole(option)}
                      aria-pressed={role === option}
                      className={`rounded-xl px-4 py-2.5 text-sm font-extrabold transition ${
                        role === option
                          ? 'bg-white text-teal-800 shadow-sm ring-1 ring-slate-200'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {option === 'doctor' ? 'Doctor' : 'Clinic admin'}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mb-5 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">{editingUser?.name}</p>
                  <p className="text-xs text-slate-500">
                    Role and doctor association cannot be changed
                  </p>
                </div>
                <span className="rounded-full bg-teal-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-teal-800">
                  {editingUser?.role === 'admin' ? 'Clinic admin' : 'Doctor'}
                </span>
              </div>
            )}

            {!isEditing && role === 'doctor' ? (
              <div className="mt-5">
                <label htmlFor="login-doctor" className={labelClassName}>
                  Doctor
                </label>
                <select
                  id="login-doctor"
                  value={doctorId}
                  onChange={(event) => selectDoctor(event.target.value)}
                  className={inputClassName}
                  disabled={submitting}
                  required
                >
                  <option value="">Select a doctor</option>
                  {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name}
                    </option>
                  ))}
                </select>
                {doctors.length === 0 ? (
                  <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    Every active doctor already has a login. Add a doctor or revoke an old login
                    first.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5">
              <label htmlFor="login-prefix" className={labelClassName}>
                Username
              </label>
              <div className="flex rounded-xl shadow-sm">
                <input
                  ref={prefixInputRef}
                  id="login-prefix"
                  value={loginPrefix}
                  onChange={(event) => {
                    setLoginPrefix(event.target.value);
                    setPrefixWasEdited(true);
                    setError(null);
                  }}
                  onBlur={() => setLoginPrefix(normalizeLoginPrefix(loginPrefix))}
                  className={`${inputClassName} rounded-r-none`}
                  placeholder={role === 'doctor' ? 'doctor.name' : 'admin.name'}
                  autoComplete="off"
                  maxLength={60}
                  disabled={submitting}
                  aria-describedby="login-suffix-help"
                  required
                />
                <span
                  id="login-suffix-help"
                  className="flex shrink-0 items-center rounded-r-xl border border-l-0 border-slate-200 bg-slate-100 px-3 text-sm font-extrabold text-slate-600"
                  title="Clinic ID suffix cannot be changed"
                >
                  .{clinicLoginNumber}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-500">Clinic ID suffix is fixed</span>
                {previewUsername ? (
                  <code className="min-w-0 truncate font-bold text-teal-700">
                    {previewUsername}
                  </code>
                ) : null}
              </div>
              {submitAttempted && !normalizedPrefix ? (
                <p className="mt-1 text-xs font-semibold text-red-600">Enter a valid username.</p>
              ) : null}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="login-password" className={labelClassName}>
                  {isEditing ? 'New password' : 'Password'}
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setError(null);
                    }}
                    className={`${inputClassName} pr-11`}
                    placeholder={isEditing ? 'Leave blank to keep' : 'At least 6 characters'}
                    autoComplete="new-password"
                    minLength={isEditing ? undefined : 6}
                    maxLength={128}
                    disabled={submitting}
                    required={!isEditing}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon hidden={!showPassword} />
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="login-confirm-password" className={labelClassName}>
                  Confirm password
                </label>
                <div className="relative">
                  <input
                    id="login-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value);
                      setError(null);
                    }}
                    className={`${inputClassName} pr-11`}
                    placeholder="Enter it again"
                    autoComplete="new-password"
                    maxLength={128}
                    disabled={submitting || (isEditing && password.length === 0)}
                    required={!isEditing || password.length > 0}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((current) => !current)}
                    className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 hover:text-slate-700 disabled:opacity-40"
                    aria-label={
                      showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'
                    }
                    disabled={isEditing && password.length === 0}
                  >
                    <EyeIcon hidden={!showConfirmPassword} />
                  </button>
                </div>
              </div>
            </div>

            {(submitAttempted || confirmPassword.length > 0) &&
            password.length > 0 &&
            !passwordLongEnough ? (
              <p className="mt-2 text-xs font-semibold text-red-600">
                Password must be at least 6 characters.
              </p>
            ) : null}
            {(submitAttempted || confirmPassword.length > 0) &&
            password.length > 0 &&
            !passwordMatches ? (
              <p className="mt-2 text-xs font-semibold text-red-600">Passwords do not match.</p>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="rounded-xl bg-teal-700 px-6 py-3 text-sm font-extrabold text-white shadow-lg shadow-teal-700/20 transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
              >
                {submitting ? 'Saving…' : isEditing ? 'Save changes' : 'Create login'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>,
    document.body,
  );
}
