'use client';

import { useClinicProfile } from '@/components/clinic/ClinicProfileProvider';

export function ClinicSwitcher() {
  const { profile, status, refresh } = useClinicProfile();
  const label = profile?.name ?? (status === 'error' ? 'Clinic details unavailable' : 'Loading clinic…');
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
  );
}
