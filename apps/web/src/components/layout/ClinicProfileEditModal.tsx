'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { clinicProfileDetailsSchema } from '@vaidya/shared';
import { DigitsInput } from '@/components/ui/DigitsInput';

import type { ClinicProfile, ClinicProfilePatch } from '@/lib/api/clinic-settings';

type ClinicProfileEditModalProps = {
  profile: ClinicProfile;
  onSave: (patch: ClinicProfilePatch) => Promise<void>;
  onClose: () => void;
};

type ClinicProfileForm = {
  name: string;
  primary_phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
};

function formFromProfile(profile: ClinicProfile): ClinicProfileForm {
  return {
    name: profile.name,
    primary_phone: (profile.primary_phone ?? '').replace(
      /^\+91[\s-]*([0-9\s-]+)$/,
      (_match, local: string) => {
        const digits = local.replace(/[\s-]/g, '');
        return digits.length === 10 ? digits : (profile.primary_phone ?? '');
      },
    ),
    address_line1: profile.address_line1 ?? '',
    address_line2: profile.address_line2 ?? '',
    city: profile.city ?? '',
    state: profile.state ?? '',
    postal_code: profile.postal_code ?? '',
    country: profile.country ?? '',
  };
}

const inputClassName =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';

const labelClassName = 'mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500';

export function ClinicProfileEditModal({ profile, onSave, onClose }: ClinicProfileEditModalProps) {
  const [form, setForm] = useState<ClinicProfileForm>(() => formFromProfile(profile));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ClinicProfileForm, string>>>(
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isSavingRef = useRef(false);

  useEffect(() => {
    nameInputRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSavingRef.current) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const updateField = (field: keyof ClinicProfileForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const fieldAttributes = (field: keyof ClinicProfileForm) => ({
    required: true,
    name: field,
    'aria-invalid': Boolean(fieldErrors[field]),
    'aria-describedby': fieldErrors[field] ? `clinic-profile-${field}-error` : undefined,
  });
  const fieldError = (field: keyof ClinicProfileForm) =>
    fieldErrors[field] ? (
      <p id={`clinic-profile-${field}-error`} className="mt-1 text-sm font-medium text-red-700">
        {fieldErrors[field]}
      </p>
    ) : null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) {
      return;
    }

    const parsed = clinicProfileDetailsSchema.safeParse(form);
    if (!parsed.success) {
      const errors: Partial<Record<keyof ClinicProfileForm, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof ClinicProfileForm;
        errors[field] ??= issue.message;
      }
      setFieldErrors(errors);
      setSaveError('Please complete all required fields and correct the highlighted details.');
      const firstField = parsed.error.issues[0]?.path[0];
      if (typeof firstField === 'string')
        formRef.current?.querySelector<HTMLInputElement>(`[name="${firstField}"]`)?.focus();
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError(null);

    try {
      await onSave(parsed.data);
      isSavingRef.current = false;
      setIsSaving(false);
      onClose();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Clinic details could not be saved. Please try again.',
      );
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="clinic-profile-edit-title"
        className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 text-slate-900 shadow-2xl"
      >
        <div className="mb-5">
          <h2 id="clinic-profile-edit-title" className="text-xl font-extrabold text-slate-900">
            Edit clinic details
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Update the clinic information shown to staff and patients.
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            All fields are required. Enter a 10-digit phone number without +91 and a 6-digit PIN
            code.
          </p>
        </div>

        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => void handleSubmit(event)}
          className="space-y-4"
        >
          <div>
            <label htmlFor="clinic-profile-name" className={labelClassName}>
              Clinic name
            </label>
            <input
              ref={nameInputRef}
              {...fieldAttributes('name')}
              id="clinic-profile-name"
              type="text"
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              className={inputClassName}
              autoComplete="organization"
              maxLength={160}
              disabled={isSaving}
            />
            {fieldError('name')}
          </div>

          <div>
            <label htmlFor="clinic-profile-phone" className={labelClassName}>
              Phone number
            </label>
            <DigitsInput
              {...fieldAttributes('primary_phone')}
              id="clinic-profile-phone"
              value={form.primary_phone}
              onValueChange={(value) => updateField('primary_phone', value)}
              className={inputClassName}
              autoComplete="tel"
              minLength={10}
              maxLength={10}
              disabled={isSaving}
            />
            {fieldError('primary_phone')}
          </div>

          <div>
            <label htmlFor="clinic-profile-address-line-1" className={labelClassName}>
              Address line 1
            </label>
            <input
              {...fieldAttributes('address_line1')}
              id="clinic-profile-address-line-1"
              type="text"
              value={form.address_line1}
              onChange={(event) => updateField('address_line1', event.target.value)}
              className={inputClassName}
              autoComplete="address-line1"
              maxLength={255}
              disabled={isSaving}
            />
            {fieldError('address_line1')}
          </div>

          <div>
            <label htmlFor="clinic-profile-address-line-2" className={labelClassName}>
              Address line 2
            </label>
            <input
              {...fieldAttributes('address_line2')}
              id="clinic-profile-address-line-2"
              type="text"
              value={form.address_line2}
              onChange={(event) => updateField('address_line2', event.target.value)}
              className={inputClassName}
              autoComplete="address-line2"
              maxLength={255}
              disabled={isSaving}
            />
            {fieldError('address_line2')}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="clinic-profile-city" className={labelClassName}>
                City
              </label>
              <input
                {...fieldAttributes('city')}
                id="clinic-profile-city"
                type="text"
                value={form.city}
                onChange={(event) => updateField('city', event.target.value)}
                className={inputClassName}
                autoComplete="address-level2"
                maxLength={120}
                disabled={isSaving}
              />
              {fieldError('city')}
            </div>

            <div>
              <label htmlFor="clinic-profile-state" className={labelClassName}>
                State
              </label>
              <input
                {...fieldAttributes('state')}
                id="clinic-profile-state"
                type="text"
                value={form.state}
                onChange={(event) => updateField('state', event.target.value)}
                className={inputClassName}
                autoComplete="address-level1"
                maxLength={120}
                disabled={isSaving}
              />
              {fieldError('state')}
            </div>

            <div>
              <label htmlFor="clinic-profile-postal-code" className={labelClassName}>
                Postal code
              </label>
              <DigitsInput
                {...fieldAttributes('postal_code')}
                id="clinic-profile-postal-code"
                value={form.postal_code}
                onValueChange={(value) => updateField('postal_code', value)}
                className={inputClassName}
                autoComplete="postal-code"
                minLength={6}
                maxLength={6}
                disabled={isSaving}
              />
              {fieldError('postal_code')}
            </div>

            <div>
              <label htmlFor="clinic-profile-country" className={labelClassName}>
                Country
              </label>
              <input
                {...fieldAttributes('country')}
                id="clinic-profile-country"
                type="text"
                value={form.country}
                onChange={(event) => updateField('country', event.target.value)}
                className={inputClassName}
                autoComplete="country-name"
                maxLength={120}
                disabled={isSaving}
              />
              {fieldError('country')}
            </div>
          </div>

          {saveError ? (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
            >
              {saveError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
