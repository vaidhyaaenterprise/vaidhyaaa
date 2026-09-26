'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type DeleteUserLoginModalProps = {
  name: string;
  username: string;
  role: 'admin' | 'doctor';
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export function DeleteUserLoginModal({
  name,
  username,
  role,
  onConfirm,
  onClose,
}: DeleteUserLoginModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
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
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
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

  const confirm = async () => {
    if (busy) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (confirmError) {
      setError(
        confirmError instanceof Error ? confirmError.message : 'The login could not be deleted.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-[26px] border border-white/70 bg-white p-6 text-slate-900 shadow-[0_28px_90px_rgba(15,23,42,0.35)] sm:p-7"
      >
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-100">
          <svg
            className="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />
          </svg>
        </div>
        <h2 id={titleId} className="mt-5 text-xl font-extrabold tracking-tight text-slate-950">
          Delete this login?
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600">
          Access for <strong>{name}</strong> ({username}) will be revoked. The{' '}
          {role === 'doctor'
            ? 'doctor profile, appointments, and clinical history'
            : 'clinic records'}{' '}
          will be preserved.
        </p>
        <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-3 text-xs font-semibold leading-5 text-amber-900">
          This removes the login only. It does not delete operational or patient records.
        </p>
        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-red-50 px-3.5 py-3 text-sm font-semibold text-red-700"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Keep login
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete login'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
