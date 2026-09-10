'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { canToggleAgent } from '@/lib/navigation';

type AgentToggleProps = {
  enabled?: boolean;
};

export function AgentToggle({ enabled = false }: AgentToggleProps) {
  const { effectiveRole } = useAuth();

  if (!canToggleAgent(effectiveRole)) {
    return null;
  }

  return (
    <div
      className={`flex items-center gap-3 rounded-full border-2 px-4 py-2.5 ${
        enabled
          ? 'border-emerald-300 bg-emerald-50'
          : 'border-slate-300 bg-slate-100'
      }`}
      aria-label="AI Voice Agent status"
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${enabled ? 'bg-emerald-600' : 'bg-slate-400'}`}
      />
      <div className="mr-2">
        <p className="text-sm font-bold text-slate-900">AI Voice Agent</p>
        <p className={`text-xs font-bold ${enabled ? 'text-emerald-700' : 'text-slate-500'}`}>
          {enabled ? 'Active' : 'Inactive'}
        </p>
      </div>
      <button
        type="button"
        disabled
        className={`relative h-[26px] w-[46px] rounded-full transition-colors ${
          enabled ? 'bg-emerald-600' : 'bg-slate-400'
        }`}
        title="Agent toggle will be enabled in a later milestone"
        aria-label="Agent toggle (coming soon)"
      >
        <span
          className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-sm ${
            enabled ? 'right-[3px]' : 'left-[3px]'
          }`}
        />
      </button>
    </div>
  );
}
