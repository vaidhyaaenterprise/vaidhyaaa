type ScheduleConflictPanelProps = {
  conflicts: string[];
  guidance?: string;
};

export function ScheduleConflictPanel({ conflicts, guidance }: ScheduleConflictPanelProps) {
  if (!conflicts.length) return null;
  return (
    <section role="alert" aria-label="Schedule conflicts" className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/70">
      <div className="flex items-start gap-3 px-4 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 3h.01" /></svg>
        </span>
        <div>
          <h4 className="text-sm font-bold text-amber-950">Review before saving</h4>
          <p className="mt-1 text-xs leading-5 text-amber-900">This change affects existing schedules or appointments.</p>
        </div>
      </div>
      <ul className="space-y-2 px-4 pb-4">
        {[...new Set(conflicts)].map((conflict) => (
          <li key={conflict} className="rounded-xl border border-amber-100 bg-white px-3.5 py-3 text-sm leading-6 text-slate-700">{conflict}</li>
        ))}
      </ul>
      {guidance && <p className="border-t border-amber-200 px-4 py-3 text-xs font-medium leading-5 text-amber-900">{guidance}</p>}
    </section>
  );
}
