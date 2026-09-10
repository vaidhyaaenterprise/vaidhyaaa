'use client';

import { useState } from 'react';
import type { SubscriptionPlan, PlatformSubscriptionChange, SubscriptionStatus } from './types';
import { useIsPlatformAdmin } from '@/hooks/useActiveClinicId';

const SUBSCRIPTION_STATUSES: { value: SubscriptionStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'trialing', label: 'Trial' },
  { value: 'manual_free', label: 'Manual Free' },
  { value: 'expired', label: 'Expired' },
  { value: 'past_due', label: 'Past Due' },
  { value: 'canceled', label: 'Canceled' },
];

const PLAN_OPTIONS = [
  { planKey: 'pilot', planName: 'Pilot' },
  { planKey: 'starter', planName: 'Starter' },
  { planKey: 'professional', planName: 'Professional' },
  { planKey: 'enterprise', planName: 'Enterprise' },
];

interface PlatformSubscriptionManagerProps {
  subscription: SubscriptionPlan;
  onPlanChange: (change: PlatformSubscriptionChange) => void;
}

export function PlatformSubscriptionManager({
  subscription,
  onPlanChange,
}: PlatformSubscriptionManagerProps) {
  const isPlatformAdmin = useIsPlatformAdmin();

  const [isEditing, setIsEditing] = useState(false);
  const [planKey, setPlanKey] = useState(subscription.planKey);
  const [status, setStatus] = useState<SubscriptionStatus>(subscription.status);
  const [trialEnd, setTrialEnd] = useState(subscription.trialEnd ?? '');
  const [notes, setNotes] = useState(subscription.notes ?? '');

  if (!isPlatformAdmin) {
    return null;
  }

  const handleEdit = () => {
    setPlanKey(subscription.planKey);
    setStatus(subscription.status);
    setTrialEnd(subscription.trialEnd ?? '');
    setNotes(subscription.notes ?? '');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleSave = () => {
    const change: PlatformSubscriptionChange = { planKey, status };
    if (trialEnd) change.trialEnd = trialEnd;
    if (notes) change.notes = notes;
    onPlanChange(change);
    setIsEditing(false);
  };

  return (
    <div className="rounded-2xl border border-amber-200 bg-white shadow-sm">
      <div className="border-b border-amber-100 bg-amber-50/50 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                Platform Admin
              </span>
              <h3 className="text-lg font-bold text-slate-900">Subscription override</h3>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              Manually assign or change the plan for this clinic.
            </p>
          </div>
          {!isEditing && (
            <button
              onClick={handleEdit}
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100"
            >
              Change
            </button>
          )}
        </div>
      </div>

      <div className="p-5">
        {!isEditing ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3.5 py-2.5">
              <span className="text-sm font-semibold text-slate-600">Plan</span>
              <span className="text-sm font-bold text-slate-900">
                {PLAN_OPTIONS.find((p) => p.planKey === subscription.planKey)?.planName ??
                  subscription.planKey}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3.5 py-2.5">
              <span className="text-sm font-semibold text-slate-600">Status</span>
              <span className="text-sm font-bold text-slate-900">
                {SUBSCRIPTION_STATUSES.find((s) => s.value === subscription.status)?.label ??
                  subscription.status}
              </span>
            </div>
            {subscription.trialEnd && (
              <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3.5 py-2.5">
                <span className="text-sm font-semibold text-slate-600">Trial end</span>
                <span className="text-sm font-bold text-slate-900">
                  {new Date(subscription.trialEnd).toLocaleDateString()}
                </span>
              </div>
            )}
            {subscription.notes && (
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-2.5">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Notes</p>
                <p className="mt-1 text-sm text-slate-700">{subscription.notes}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Plan
              </label>
              <select
                value={planKey}
                onChange={(e) => setPlanKey(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              >
                {PLAN_OPTIONS.map((plan) => (
                  <option key={plan.planKey} value={plan.planKey}>
                    {plan.planName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              >
                {SUBSCRIPTION_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Trial end date
              </label>
              <input
                type="date"
                value={trialEnd ? trialEnd.split('T')[0] : ''}
                onChange={(e) => setTrialEnd(e.target.value ? `${e.target.value}T00:00:00.000Z` : '')}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Reason for plan change, special terms, etc."
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                className="rounded-xl bg-amber-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-800"
              >
                Save
              </button>
              <button
                onClick={handleCancel}
                className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
