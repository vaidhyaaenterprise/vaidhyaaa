'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  registerClinicAdmin,
  resendVerificationCode,
  sendVerificationCode,
  verifyEmail,
  type RegisterClinicAdminResult,
} from '@/lib/api/auth';
import { ApiRequestError } from '@/lib/api/client';

const inputClasses =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500';

const RESEND_COOLDOWN_SECONDS = 60;

type EmailCodeState = 'idle' | 'sending' | 'sent' | 'verifying' | 'verified';

export type RegisterClinicFormProps = {
  onRegistered: (email: string) => void;
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiRequestError ? err.apiError.message : fallback;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) {
    return email;
  }
  const visible = local.slice(0, Math.min(1, local.length));
  return `${visible}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
}

export function RegisterClinicForm({ onRegistered }: RegisterClinicFormProps) {
  const [form, setForm] = useState({
    clinic_name: '',
    clinic_phone: '',
    address_line1: '',
    city: '',
    state: '',
    country: 'India',
    zip_code: '',
    admin_name: '',
    admin_email: '',
    admin_phone: '',
    password: '',
    confirm_password: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterClinicAdminResult | null>(null);

  const [codeState, setCodeState] = useState<EmailCodeState>('idle');
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [codeSentAt, setCodeSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const update = (field: keyof typeof form) => (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    if (field === 'admin_email') {
      setCodeState('idle');
      setOtp('');
      setOtpError(null);
      setCodeSentAt(null);
    }
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.admin_email.trim());

  const canSubmit =
    form.clinic_name.trim() &&
    form.clinic_phone.trim() &&
    form.address_line1.trim() &&
    form.city.trim() &&
    form.state.trim() &&
    form.country.trim() &&
    form.zip_code.trim() &&
    form.admin_name.trim() &&
    form.admin_email.trim() &&
    form.admin_phone.trim() &&
    form.password.length >= 6 &&
    form.confirm_password === form.password &&
    codeState === 'verified';

  const remainingCooldown = useMemo(() => {
    if (!codeSentAt) {
      return 0;
    }
    const remaining = Math.ceil(
      (codeSentAt + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000,
    );
    return Math.max(0, remaining);
  }, [codeSentAt, now]);

  useEffect(() => {
    if (!codeSentAt || codeSentAt + RESEND_COOLDOWN_SECONDS * 1000 <= now) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [codeSentAt, now]);

  const handleSendCode = async () => {
    if (!emailValid || codeState === 'sending' || codeState === 'verifying' || codeState === 'verified') {
      return;
    }
    setCodeState('sending');
    setOtpError(null);
    try {
      await sendVerificationCode(form.admin_email.trim());
      setCodeState('sent');
      setCodeSentAt(Date.now());
    } catch (err) {
      setCodeState('idle');
      setOtpError(errorMessage(err, 'Could not send the verification code. Please try again.'));
    }
  };

  const handleResendCode = async () => {
    if (!emailValid || codeState === 'sending' || codeState === 'verifying' || codeState === 'verified') {
      return;
    }
    setCodeState('sending');
    setOtpError(null);
    try {
      await resendVerificationCode(form.admin_email.trim());
      setCodeState('sent');
      setCodeSentAt(Date.now());
      setOtp('');
    } catch (err) {
      setCodeState('sent');
      setOtpError(errorMessage(err, 'Could not resend the verification code. Please try again.'));
    }
  };

  const handleVerifyCode = async () => {
    if (!/^\d{6}$/.test(otp) || codeState === 'verifying') {
      return;
    }
    setCodeState('verifying');
    setOtpError(null);
    try {
      await verifyEmail(form.admin_email.trim(), otp);
      setCodeState('verified');
    } catch (err) {
      setCodeState('sent');
      setOtpError(errorMessage(err, 'Invalid verification code. Please try again.'));
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const registered = await registerClinicAdmin(form);
      setResult(registered);
    } catch (err) {
      setError(errorMessage(err, 'Registration failed. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="rounded-2xl border-2 border-teal-200 bg-teal-50/60 p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-700 text-white">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
              <path
                d="M5 13l4 4L19 7"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <p className="text-lg font-black text-slate-900">Clinic registered!</p>
            <p className="text-xs text-slate-600">Your clinic account has been created.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          <div className="rounded-xl border border-teal-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Admin email address
            </p>
            <p className="mt-1 text-base font-bold text-slate-900">{result.email}</p>
          </div>
          <div className="rounded-xl border border-teal-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Clinic unique number
            </p>
            <p className="mt-1 text-3xl font-black text-teal-700">
              {result.clinic_unique_number}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Keep this number safe. It is fixed forever and is part of every login username.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onRegistered(result.email)}
          className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-sm font-extrabold text-white transition-colors hover:bg-teal-800"
        >
          Go to sign in
        </button>
      </div>
    );
  }

  const showOtpField = codeState === 'sent' || codeState === 'verifying';
  const resendEnabled =
    codeState === 'sent' && remainingCooldown === 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <p className="mb-3 text-lg font-black text-slate-900">Register your clinic</p>
        <p className="text-xs text-slate-500">
          Create the first admin login for your clinic. You will receive your clinic&apos;s
          unique number after registration.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="reg-clinic-name">
          Hospital / Clinic Name
        </label>
        <input id="reg-clinic-name" value={form.clinic_name} onChange={update('clinic_name')} placeholder="e.g. Sri Murugan Clinic" className={inputClasses} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="reg-clinic-phone">
          Hospital Phone Number
        </label>
        <input id="reg-clinic-phone" value={form.clinic_phone} onChange={update('clinic_phone')} placeholder="e.g. +91 98400 12345" className={inputClasses} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="reg-address">
          Hospital Address
        </label>
        <input id="reg-address" value={form.address_line1} onChange={update('address_line1')} placeholder="Street address" className={inputClasses} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="reg-city">
            City
          </label>
          <input id="reg-city" value={form.city} onChange={update('city')} placeholder="City" className={inputClasses} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="reg-state">
            State
          </label>
          <input id="reg-state" value={form.state} onChange={update('state')} placeholder="State" className={inputClasses} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="reg-country">
            Country
          </label>
          <input id="reg-country" value={form.country} onChange={update('country')} className={inputClasses} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="reg-zip">
            ZIP / Postal Code
          </label>
          <input id="reg-zip" value={form.zip_code} onChange={update('zip_code')} placeholder="ZIP / Postal code" className={inputClasses} />
        </div>
      </div>

      <div className="border-t border-slate-200 pt-3">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          Administrator
        </p>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="reg-admin-name">
            Administrator Full Name
          </label>
          <input id="reg-admin-name" value={form.admin_name} onChange={update('admin_name')} placeholder="Full name" className={inputClasses} />
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-700" htmlFor="reg-admin-email">
              Admin Email
              {codeState === 'verified' ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-extrabold text-teal-800">
                  <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" aria-hidden>
                    <path
                      d="M5 13l4 4L19 7"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Verified
                </span>
              ) : null}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="reg-admin-email"
                type="email"
                value={form.admin_email}
                onChange={update('admin_email')}
                placeholder="admin@clinic.com"
                disabled={codeState === 'sent' || codeState === 'verifying' || codeState === 'verified'}
                className={`${inputClasses} sm:min-w-0 sm:flex-1 disabled:bg-slate-50 disabled:text-slate-400`}
              />
              <button
                type="button"
                onClick={() => void handleSendCode()}
                disabled={!emailValid || codeState === 'sending' || codeState === 'verifying' || codeState === 'verified'}
                className="w-full shrink-0 rounded-xl border border-teal-700 px-3 py-2.5 text-xs font-extrabold text-teal-700 transition-colors hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 sm:w-32"
              >
                {codeState === 'sending'
                  ? 'Sending...'
                  : codeState === 'verified'
                    ? 'Verified'
                    : 'Send Code'}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="reg-admin-phone">
              Admin Mobile Number
            </label>
            <input id="reg-admin-phone" value={form.admin_phone} onChange={update('admin_phone')} placeholder="+91 ..." className={inputClasses} />
          </div>
        </div>

        {showOtpField ? (
          <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50/50 p-3">
            <p className="text-xs font-semibold text-slate-700">
              Verification code sent to your email.
            </p>
            <p className="text-xs text-slate-500">
              Please check your inbox{form.admin_email ? ` at ${maskEmail(form.admin_email.trim())}` : ''}.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                id="reg-otp"
                inputMode="numeric"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm tracking-[0.3em] text-slate-900 outline-none focus:border-teal-500"
              />
              <button
                type="button"
                onClick={() => void handleVerifyCode()}
                disabled={!/^\d{6}$/.test(otp) || codeState === 'verifying'}
                className="w-28 shrink-0 rounded-xl bg-teal-700 px-3 py-2.5 text-xs font-extrabold text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {codeState === 'verifying' ? 'Verifying...' : 'Verify'}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <p className="text-xs text-slate-500">Didn&apos;t receive the code?</p>
              <button
                type="button"
                onClick={() => void handleResendCode()}
                disabled={!resendEnabled}
                className="text-xs font-extrabold text-teal-700 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {remainingCooldown > 0
                  ? `Resend Code available in ${remainingCooldown} seconds`
                  : 'Resend Code'}
              </button>
            </div>
            {otpError ? (
              <p className="mt-1.5 text-xs font-semibold text-red-600">{otpError}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="reg-password">
              Password
            </label>
            <input id="reg-password" type="password" value={form.password} onChange={update('password')} placeholder="At least 6 characters" className={inputClasses} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="reg-confirm-password">
              Confirm Password
            </label>
            <input id="reg-confirm-password" type="password" value={form.confirm_password} onChange={update('confirm_password')} placeholder="Repeat password" className={inputClasses} />
          </div>
        </div>
        {form.confirm_password.length > 0 && form.password !== form.confirm_password ? (
          <p className="mt-1 text-xs font-semibold text-red-600">Passwords do not match.</p>
        ) : null}
      </div>

      {error ? <p className="text-xs font-semibold text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-sm font-extrabold text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Registering...' : 'Register clinic'}
      </button>
    </form>
  );
}
