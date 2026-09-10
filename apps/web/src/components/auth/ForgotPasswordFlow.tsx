'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  forgotPassword,
  resendPasswordResetCode,
  resetPassword,
  verifyPasswordResetCode,
} from '@/lib/api/auth';
import { ApiRequestError } from '@/lib/api/client';

const inputClasses =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500';

const RESEND_COOLDOWN_SECONDS = 60;

type Step = 'email' | 'verify' | 'new_password' | 'success';

export type ForgotPasswordFlowProps = {
  onBack: () => void;
  onDone: () => void;
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

export function ForgotPasswordFlow({ onBack, onDone }: ForgotPasswordFlowProps) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeSentAt, setCodeSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const remainingCooldown = useMemo(() => {
    if (!codeSentAt) {
      return 0;
    }
    return Math.max(
      0,
      Math.ceil((codeSentAt + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000),
    );
  }, [codeSentAt, now]);

  useEffect(() => {
    if (!codeSentAt || codeSentAt + RESEND_COOLDOWN_SECONDS * 1000 <= now) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [codeSentAt, now]);

  const handleSendCode = async (resend = false) => {
    if (!emailValid || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const send = resend ? resendPasswordResetCode : forgotPassword;
      await send(email.trim());
      setCodeSentAt(Date.now());
      setOtp('');
      setStep('verify');
    } catch (err) {
      setError(
        errorMessage(
          err,
          'Could not send the code. Please try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(otp) || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyPasswordResetCode(email.trim(), otp);
      setStep('new_password');
    } catch (err) {
      setError(errorMessage(err, 'Invalid verification code. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (newPassword.length < 6 || confirmPassword !== newPassword || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email.trim(), otp, newPassword);
      setStep('success');
    } catch (err) {
      setError(errorMessage(err, 'Could not reset your password. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1 text-xs font-bold text-slate-500 transition-colors hover:text-slate-800"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden>
          <path
            d="M15 19l-7-7 7-7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back to sign in
      </button>

      <h1 className="text-[28px] font-black leading-none text-slate-900">
        {step === 'email' && 'Forgot password'}
        {step === 'verify' && 'Verification code'}
        {step === 'new_password' && 'Create new password'}
        {step === 'success' && 'Password reset complete'}
      </h1>

      {step === 'email' ? (
        <>
          <p className="mt-2 text-sm text-slate-600">
            Enter your registered email address and we&apos;ll send you a verification code.
          </p>
          <div className="mt-5">
            <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="fp-email">
              Email Address
            </label>
            <input
              id="fp-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="user@example.com"
              autoComplete="email"
              className={inputClasses}
            />
          </div>
          <button
            type="button"
            onClick={() => void handleSendCode()}
            disabled={!emailValid || busy}
            className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-sm font-extrabold text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Sending...' : 'Send Code'}
          </button>
        </>
      ) : null}

      {step === 'verify' ? (
        <>
          <div className="mt-5 rounded-xl border border-teal-200 bg-teal-50/60 p-4">
            <p className="text-xs font-semibold text-slate-700">
              We sent a verification code to:
            </p>
            <p className="mt-1 text-sm font-black text-slate-900">{maskEmail(email.trim())}</p>
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="fp-otp">
              Verification Code
            </label>
            <input
              id="fp-otp"
              inputMode="numeric"
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm tracking-[0.3em] text-slate-900 outline-none focus:border-teal-500"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleVerify()}
            disabled={!/^\d{6}$/.test(otp) || busy}
            className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-sm font-extrabold text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Verifying...' : 'Verify'}
          </button>
          <div className="mt-3 flex items-center gap-2">
            <p className="text-xs text-slate-500">Didn&apos;t receive the code?</p>
            <button
              type="button"
              onClick={() => void handleSendCode(true)}
              disabled={busy || remainingCooldown > 0}
              className="text-xs font-extrabold text-teal-700 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {remainingCooldown > 0
                ? `Resend Code available in ${remainingCooldown} seconds`
                : 'Resend Code'}
            </button>
          </div>
        </>
      ) : null}

      {step === 'new_password' ? (
        <>
          <p className="mt-2 text-sm text-slate-600">
            Choose a new password for <span className="font-bold">{maskEmail(email.trim())}</span>.
          </p>
          <div className="mt-5">
            <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="fp-new-password">
              New Password
            </label>
            <input
              id="fp-new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="At least 6 characters"
              autoComplete="new-password"
              className={inputClasses}
            />
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="fp-confirm-password">
              Confirm Password
            </label>
            <input
              id="fp-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat password"
              autoComplete="new-password"
              className={inputClasses}
            />
          </div>
          {confirmPassword.length > 0 && newPassword !== confirmPassword ? (
            <p className="mt-1 text-xs font-semibold text-red-600">Passwords do not match.</p>
          ) : null}
          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={newPassword.length < 6 || confirmPassword !== newPassword || busy}
            className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-sm font-extrabold text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Resetting...' : 'Reset Password'}
          </button>
        </>
      ) : null}

      {step === 'success' ? (
        <>
          <div className="mt-5 flex items-start gap-3 rounded-xl border-2 border-teal-200 bg-teal-50/60 p-4">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-teal-700 text-white">
              <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5" aria-hidden>
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
              <p className="text-sm font-extrabold text-slate-900">Password reset successfully.</p>
              <p className="mt-0.5 text-xs text-slate-600">
                You can now sign in with your new password.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDone}
            className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-sm font-extrabold text-white transition-colors hover:bg-teal-800"
          >
            Back to Login
          </button>
        </>
      ) : null}

      {error ? (
        <p className="mt-3 text-xs font-semibold text-red-600">{error}</p>
      ) : null}
    </div>
  );
}