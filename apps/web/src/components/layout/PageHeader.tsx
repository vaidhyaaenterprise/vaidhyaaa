'use client';

import type { ReactNode } from 'react';

import { AgentToggle } from '@/components/layout/AgentToggle';

type PageHeaderProps = {
  title: string;
  description: string;
  actions?: ReactNode;
  showAgentToggle?: boolean;
};

export function PageHeader({
  title,
  description,
  actions,
  showAgentToggle = false,
}: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 className="text-[clamp(1.25rem,2.5vw,_2rem)] font-black tracking-tight text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {(showAgentToggle || actions) && (
        <div className="flex flex-wrap items-center gap-2.5">
          {showAgentToggle ? <AgentToggle /> : null}
          {actions}
        </div>
      )}
    </header>
  );
}
