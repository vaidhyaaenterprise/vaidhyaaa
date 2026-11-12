'use client';

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useClinicProfile } from '@/components/clinic/ClinicProfileProvider';
import { ClinicProfileEditModal } from '@/components/layout/ClinicProfileEditModal';

export function ClinicSwitcher() {
  const { clinicRole, me } = useAuth();
  const { clinicId, profile, status, refresh, updateProfile } = useClinicProfile();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const canEdit =
    clinicRole?.role === 'clinic_admin' || me?.user.platform_role === 'platform_admin';

  const closeEditModal = useCallback(() => {
    setIsEditOpen(false);
  }, []);

  useEffect(() => {
    setIsEditOpen(false);
  }, [clinicId]);

  const label =
    profile?.name ?? (status === 'error' ? 'Clinic details unavailable' : 'Loading clinic…');
  const address = [
    profile?.address_line1,
    profile?.address_line2,
    profile?.city,
    profile?.state,
    profile?.postal_code,
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');
  const addressDetail =
    address ||
    (profile
      ? 'Address not set yet'
      : status === 'error'
        ? 'Clinic profile could not be loaded.'
        : 'Loading clinic details…');
  const detailLines = [
    addressDetail,
    profile ? `Clinic line: ${profile.primary_phone ?? '—'}` : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <>
      <div className="rounded-[18px] border border-white/10 bg-white/[0.06] p-3.5">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 text-sm font-bold text-white">{label}</p>
          <div className="flex shrink-0 items-center gap-1.5">
            {profile ? (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-300">
                #{profile.clinic_unique_number}
              </span>
            ) : null}
            {profile && canEdit ? (
              <button
                type="button"
                onClick={() => setIsEditOpen(true)}
                aria-label="Edit clinic details"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-teal-300/70"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
          {detailLines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>
        {status === 'error' ? (
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-[11px] text-amber-300/80">Could not load clinic details.</p>
            <button
              type="button"
              onClick={refresh}
              className="text-[11px] font-bold text-teal-300 hover:text-teal-200"
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>

      {isEditOpen && profile ? (
        <ClinicProfileEditModal profile={profile} onSave={updateProfile} onClose={closeEditModal} />
      ) : null}
    </>
  );
}
