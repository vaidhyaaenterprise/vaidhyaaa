import type { ReactNode } from 'react';

type StateShellProps = {
  title: string;
  description?: string;
  children?: ReactNode;
};

export function LoadingState({ title, description }: StateShellProps) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-[22px] border border-slate-200 bg-white px-8 py-16 text-center shadow-card"
      role="status"
      aria-live="polite"
    >
      <div className="mb-4 h-10 w-10 animate-spin rounded-full border-[3px] border-slate-200 border-t-brand-600" />
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p> : null}
    </div>
  );
}

export function EmptyState({ title, description, children }: StateShellProps) {
  return (
    <div
      className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-8 py-14 text-center"
      role="status"
    >
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[18px] bg-slate-900 text-lg font-black text-white">
        ∅
      </div>
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p> : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  children,
}: StateShellProps) {
  return (
    <div
      className="rounded-[22px] border border-red-200 bg-red-50 px-8 py-14 text-center"
      role="alert"
    >
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[18px] bg-red-600 text-lg font-black text-white">
        !
      </div>
      <h3 className="text-lg font-bold text-red-900">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-sm text-red-700">{description}</p> : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}
