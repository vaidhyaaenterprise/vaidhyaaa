import type { ReactNode } from 'react';

type PlaceholderPanelProps = {
  title: string;
  description: string;
  children?: ReactNode;
};

export function PlaceholderPanel({ title, description, children }: PlaceholderPanelProps) {
  return (
    <section className="rounded-[22px] border border-slate-200 bg-white p-6 shadow-card">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}
