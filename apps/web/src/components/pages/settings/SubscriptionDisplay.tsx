'use client';

import type { SubscriptionPlan, SubscriptionStatus } from './types';

interface SubscriptionDisplayProps {
  subscription: SubscriptionPlan;
}

const STATUS_CONFIG: Record<SubscriptionStatus, { label: string; classes: string }> = {
  active: { label: 'Active', classes: 'bg-green-50 text-green-700 border-green-300' },
  trialing: { label: 'Trial', classes: 'bg-blue-50 text-blue-700 border-blue-300' },
  manual_free: { label: 'Manual Free', classes: 'bg-slate-50 text-slate-600 border-slate-300' },
  expired: { label: 'Expired', classes: 'bg-red-50 text-red-700 border-red-300' },
  past_due: { label: 'Past Due', classes: 'bg-amber-50 text-amber-700 border-amber-300' },
  canceled: { label: 'Canceled', classes: 'bg-red-50 text-red-700 border-red-300' },
};

function UsageBar({ used, included }: { used: number; included: number }) {
  const percentage = included > 0 ? Math.min((used / included) * 100, 100) : 0;
  const isOverThreshold = percentage >= 80;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-500">
          {used.toLocaleString()} / {included.toLocaleString()} min
        </span>
        <span className={`font-bold ${isOverThreshold ? 'text-amber-600' : 'text-teal-600'}`}>
          {Math.round(percentage)}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full transition-all ${
            isOverThreshold ? 'bg-amber-500' : 'bg-teal-600'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export function SubscriptionDisplay({ subscription }: SubscriptionDisplayProps) {
  const statusCfg = STATUS_CONFIG[subscription.status] ?? STATUS_CONFIG.active;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="text-lg font-bold text-slate-900">Subscription & limits</h3>
        <p className="mt-0.5 text-sm text-slate-500">
          Current plan details and monthly usage. Limits are enforced by the backend.
        </p>
      </div>

      <div className="p-5">
        <div className="mb-5 flex items-center justify-between rounded-xl bg-slate-50 p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Current plan</p>
            <p className="mt-1 text-lg font-black text-slate-900">{subscription.planName}</p>
            <p className="mt-0.5 text-xs text-slate-400">Key: {subscription.planKey}</p>
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${statusCfg.classes}`}
          >
            {statusCfg.label}
          </span>
        </div>

        <div className="mb-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            Voice minutes usage
          </p>
          <UsageBar used={subscription.usedVoiceMinutes} included={subscription.includedVoiceMinutes} />
          {subscription.overageMinutes != null && subscription.overageMinutes > 0 && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-bold text-amber-800">
                Overage: {subscription.overageMinutes} minutes beyond plan limit
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3.5 py-2.5">
            <span className="text-sm font-semibold text-slate-600">Max concurrent calls</span>
            <span className="text-sm font-bold text-slate-900">{subscription.maxConcurrentCalls}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3.5 py-2.5">
            <span className="text-sm font-semibold text-slate-600">Recording retention</span>
            <span className="text-sm font-bold text-slate-900">{subscription.recordingRetentionDays} days</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3.5 py-2.5">
            <span className="text-sm font-semibold text-slate-600">Transcript retention</span>
            <span className="text-sm font-bold text-slate-900">{subscription.transcriptRetentionDays} days</span>
          </div>
          {subscription.trialEnd && (
            <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3.5 py-2.5">
              <span className="text-sm font-semibold text-slate-600">Trial ends</span>
              <span className="text-sm font-bold text-slate-900">
                {new Date(subscription.trialEnd).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>

        <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-xs font-bold text-blue-800">
            Plan limits are enforced by the backend. Contact support to upgrade your plan.
          </p>
        </div>
      </div>
    </div>
  );
}
