'use client';

import { useEffect, useId, useState } from 'react';

interface EditablePatientNameProps {
  patientName: string;
  onSave?: ((patientName: string) => Promise<void>) | undefined;
  className?: string;
}

export function EditablePatientName({
  patientName,
  onSave,
  className = 'text-base font-bold text-slate-900',
}: EditablePatientNameProps) {
  const inputId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(patientName);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraftName(patientName);
    }
  }, [isEditing, patientName]);

  const closeEditor = () => {
    if (isSaving) return;
    setDraftName(patientName);
    setError(null);
    setIsEditing(false);
  };

  const saveName = async () => {
    const trimmedName = draftName.trim();
    if (!onSave || isSaving) return;
    if (trimmedName.length < 2) {
      setError('Patient name must contain at least 2 characters.');
      return;
    }
    if (trimmedName === patientName) {
      closeEditor();
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onSave(trimmedName);
      setIsEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update patient name.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isEditing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <p className={className}>{patientName}</p>
        {onSave ? (
          <button
            type="button"
            onClick={() => {
              setDraftName(patientName);
              setError(null);
              setIsEditing(true);
            }}
            aria-label={`Edit patient name for ${patientName}`}
            title="Edit patient name"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
              <path
                d="M4 13.75V16h2.25L14.4 7.85l-2.25-2.25L4 13.75Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="m10.9 6.85 2.25 2.25"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-md">
      <label htmlFor={inputId} className="sr-only">
        Patient name
      </label>
      <input
        id={inputId}
        type="text"
        value={draftName}
        maxLength={120}
        autoFocus
        disabled={isSaving}
        onChange={(event) => {
          setDraftName(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void saveName();
          if (event.key === 'Escape') closeEditor();
        }}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:opacity-60"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void saveName()}
          disabled={isSaving || draftName.trim().length < 2}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save name'}
        </button>
        <button
          type="button"
          onClick={closeEditor}
          disabled={isSaving}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
