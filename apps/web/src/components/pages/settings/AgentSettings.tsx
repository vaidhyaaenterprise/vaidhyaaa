'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import type { AgentSettings, AnsweringMode, BookingMode } from './types';

interface AgentSettingsProps {
  settings: AgentSettings;
  onUpdateSettings: (settings: Partial<AgentSettings>) => void;
}

export function AgentSettings({ settings, onUpdateSettings }: AgentSettingsProps) {
  const { effectiveRole } = useAuth();
  const isAdmin = effectiveRole === 'admin';

  const [isEditing, setIsEditing] = useState(false);
  const [tempSettings, setTempSettings] = useState<AgentSettings>(settings);

  const handleEdit = () => {
    setTempSettings(settings);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setTempSettings(settings);
  };

  const handleSave = () => {
    if (!tempSettings.fallbackPhone) {
      alert('Fallback phone is required before enabling voice agent');
      return;
    }

    onUpdateSettings(tempSettings);
    setIsEditing(false);
    // TODO: Call API to save settings
  };

  const getAnsweringModeLabel = (mode: AnsweringMode) => {
    switch (mode) {
      case 'off':
        return 'Off';
      case 'always_on':
        return 'Always on';
      case 'after_hours_only':
        return 'After hours only';
      case 'overflow_after_n_rings':
        return `After ${tempSettings.overflowAfterRings} rings`;
      case 'holiday_only':
        return 'Holidays only';
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-lg font-bold text-slate-900">Agent settings</h3>
        <div className="space-y-3">
          <div className="flex justify-between rounded-lg bg-slate-50 p-3">
            <span className="text-sm font-semibold text-slate-600">Status</span>
            <span className={`text-sm font-bold ${settings.agentEnabled ? 'text-green-600' : 'text-slate-500'}`}>
              {settings.agentEnabled ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="flex justify-between rounded-lg bg-slate-50 p-3">
            <span className="text-sm font-semibold text-slate-600">Answering mode</span>
            <span className="text-sm font-bold text-slate-900">{getAnsweringModeLabel(settings.answeringMode)}</span>
          </div>
          <div className="flex justify-between rounded-lg bg-slate-50 p-3">
            <span className="text-sm font-semibold text-slate-600">Booking mode</span>
            <span className="text-sm font-bold text-slate-900">
              {settings.bookingMode === 'pending_confirmation'
                ? 'Pending confirmation'
                : 'Auto confirmation'}
            </span>
          </div>
          <div className="flex justify-between rounded-lg bg-slate-50 p-3">
            <span className="text-sm font-semibold text-slate-600">Fallback phone</span>
            <span className="text-sm font-bold text-slate-900">{settings.fallbackPhone}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-900">Agent settings</h3>
        {!isEditing && (
          <button
            onClick={handleEdit}
            className="rounded-xl border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100"
          >
            Edit
          </button>
        )}
      </div>

      {!isEditing ? (
        <div className="space-y-3">
          <div className="flex justify-between rounded-lg bg-slate-50 p-3">
            <span className="text-sm font-semibold text-slate-600">Status</span>
            <span className={`text-sm font-bold ${settings.agentEnabled ? 'text-green-600' : 'text-slate-500'}`}>
              {settings.agentEnabled ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="flex justify-between rounded-lg bg-slate-50 p-3">
            <span className="text-sm font-semibold text-slate-600">Answering mode</span>
            <span className="text-sm font-bold text-slate-900">{getAnsweringModeLabel(settings.answeringMode)}</span>
          </div>
          <div className="flex justify-between rounded-lg bg-slate-50 p-3">
            <span className="text-sm font-semibold text-slate-600">Booking mode</span>
            <span className="text-sm font-bold text-slate-900">
              {settings.bookingMode === 'pending_confirmation'
                ? 'Pending confirmation'
                : 'Auto confirmation'}
            </span>
          </div>
          <div className="flex justify-between rounded-lg bg-slate-50 p-3">
            <span className="text-sm font-semibold text-slate-600">Fallback phone</span>
            <span className="text-sm font-bold text-slate-900">{settings.fallbackPhone}</span>
          </div>
          {!settings.onboardingComplete && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-bold text-amber-800">
                ⚠ Onboarding incomplete. Agent cannot be enabled until clinic setup is complete.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={tempSettings.agentEnabled}
                onChange={(e) => setTempSettings({ ...tempSettings, agentEnabled: e.target.checked })}
                disabled={!tempSettings.onboardingComplete}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
              />
              <div>
                <span className="text-sm font-bold text-slate-900">Enable voice agent</span>
                {!tempSettings.onboardingComplete && (
                  <p className="text-xs text-slate-500">Complete onboarding to enable</p>
                )}
              </div>
            </label>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
              Answering mode
            </label>
            <select
              value={tempSettings.answeringMode}
              onChange={(e) => setTempSettings({ ...tempSettings, answeringMode: e.target.value as AnsweringMode })}
              className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
            >
              <option value="off">Off</option>
              <option value="always_on">Always on</option>
              <option value="after_hours_only">After hours only</option>
              <option value="overflow_after_n_rings">After N rings</option>
              <option value="holiday_only">Holidays only</option>
            </select>
          </div>

          {tempSettings.answeringMode === 'overflow_after_n_rings' && (
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Rings before overflow
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={tempSettings.overflowAfterRings}
                onChange={(e) => setTempSettings({ ...tempSettings, overflowAfterRings: parseInt(e.target.value) })}
                className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
              Booking mode
            </label>
            <select
              value={tempSettings.bookingMode}
              onChange={(e) => setTempSettings({ ...tempSettings, bookingMode: e.target.value as BookingMode })}
              className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
            >
              <option value="pending_confirmation">Pending confirmation</option>
              <option value="auto_confirm">Auto confirmation</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
              Fallback phone *
            </label>
            <input
              type="tel"
              value={tempSettings.fallbackPhone}
              onChange={(e) => setTempSettings({ ...tempSettings, fallbackPhone: e.target.value })}
              placeholder="+91 98765 43210"
              className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              required
            />
            {!tempSettings.fallbackPhone && (
              <p className="mt-1 text-xs text-red-600">Fallback phone is required to enable voice agent</p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!tempSettings.fallbackPhone}
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
