'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import type { NotificationSettings, NotificationChannel, NotificationEvent } from './types';

interface NotificationSettingsProps {
  settings: NotificationSettings;
  notificationEvents: NotificationEvent[];
  onUpdateSettings: (settings: Partial<NotificationSettings>) => Promise<void>;
}

export function NotificationSettings({
  settings,
  notificationEvents,
  onUpdateSettings,
}: NotificationSettingsProps) {
  const { effectiveRole } = useAuth();
  const isAdmin = effectiveRole === 'admin';

  const [isEditing, setIsEditing] = useState(false);
  const [tempSettings, setTempSettings] = useState<NotificationSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleEdit = () => {
    setTempSettings(settings);
    setSaveError(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setTempSettings(settings);
    setSaveError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onUpdateSettings(tempSettings);
      setIsEditing(false);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Failed to save notification settings.',
      );
    } finally {
      setSaving(false);
    }
  };

  const getChannelBadge = (channel: NotificationChannel) => {
    switch (channel) {
      case 'whatsapp':
        return (
          <span className="rounded-full border-2 border-green-300 bg-green-50 px-3 py-1 text-xs font-bold text-green-700">
            WhatsApp
          </span>
        );
      case 'sms':
        return (
          <span className="rounded-full border-2 border-blue-300 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
            SMS
          </span>
        );
      case 'email':
        return (
          <span className="rounded-full border-2 border-purple-300 bg-purple-50 px-3 py-1 text-xs font-bold text-purple-700">
            Email
          </span>
        );
      case 'none':
        return (
          <span className="rounded-full border-2 border-slate-300 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">
            None
          </span>
        );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sent':
        return (
          <span className="rounded-full border-2 border-green-300 bg-green-50 px-3 py-1 text-xs font-bold text-green-700">
            Sent
          </span>
        );
      case 'failed':
        return (
          <span className="rounded-full border-2 border-red-300 bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
            Failed
          </span>
        );
      case 'pending':
        return (
          <span className="rounded-full border-2 border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
            Pending
          </span>
        );
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-lg font-bold text-slate-900">Notification settings</h3>
        <p className="text-sm text-slate-500">
          Access denied. Notification settings are admin-only.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-900">Notification settings</h3>
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
            <span className="text-sm font-semibold text-slate-600">
              Notify staff on pending appointment
            </span>
            <span
              className={`text-sm font-bold ${settings.notifyStaffOnPendingAppointment ? 'text-green-600' : 'text-slate-500'}`}
            >
              {settings.notifyStaffOnPendingAppointment ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="text-xs font-bold text-blue-800">
              ℹ Patients are notified only after appointment confirmation
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={tempSettings.notifyStaffOnPendingAppointment}
                onChange={(e) =>
                  setTempSettings({
                    ...tempSettings,
                    notifyStaffOnPendingAppointment: e.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
              />
              <span className="text-sm font-bold text-slate-900">
                Notify staff on pending appointment
              </span>
            </label>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="text-xs font-bold text-blue-800">
              ℹ Patients are notified only after appointment confirmation
            </p>
          </div>

          <div className="flex gap-2">
            {saveError && (
              <p className="self-center text-xs font-semibold text-red-600">{saveError}</p>
            )}
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {notificationEvents.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">
            Recent notification events
          </h4>
          <div className="space-y-2">
            {notificationEvents.slice(0, 5).map((event) => (
              <div key={event.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{event.recipient}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(event.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {getChannelBadge(event.channel)}
                    {getStatusBadge(event.status)}
                  </div>
                </div>
                {event.errorMessage && <p className="text-xs text-red-600">{event.errorMessage}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
