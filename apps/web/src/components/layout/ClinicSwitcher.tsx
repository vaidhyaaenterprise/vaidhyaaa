'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { DEV_SEED } from '@/lib/dev-auth/constants';
import { ApiRequestError } from '@/lib/api/client';
import { fetchClinicProfile, type ClinicProfile } from '@/lib/api/clinic-settings';

type ClinicSwitcherProps = {
  clinicName?: string | null;
};

export function ClinicSwitcher({ clinicName }: ClinicSwitcherProps) {
  const { clinicRole } = useAuth();
  const [profile, setProfile] = useState<ClinicProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const clinicId = clinicRole?.clinic_id ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!clinicId) {
      return;
    }
    setProfile(null);
    setFailed(false);
    fetchClinicProfile(clinicId)
      .then((result) => {
        if (!cancelled) {
          setProfile(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && err instanceof ApiRequestError) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  const label = profile?.name ?? clinicName ?? DEV_SEED.CLINIC_NAME;
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
    address || (profile ? 'Address not set yet' : 'Loading clinic details…');
  const detailLines = [
    addressDetail,
    profile ? `Clinic line: ${profile.primary_phone ?? '—'}` : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[0.06] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-white">{label}</p>
        {profile ? (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-300">
            #{profile.clinic_unique_number}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
        {detailLines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </p>
      {failed ? (
        <p className="mt-1 text-[11px] text-amber-300/80">Could not load clinic details.</p>
      ) : null}
    </div>
  );
}