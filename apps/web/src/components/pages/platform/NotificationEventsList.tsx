'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useIsPlatformAdmin } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import { fetchPlatformNotifications } from '@/lib/api/clinic-clinical';
import {
  cancelPlatformNotification,
  retryPlatformNotification,
} from '@/lib/api/clinic-subscription';

import type { NotificationEventItem } from './types';

type ApiNotificationRow = {
  id: string;
  clinic_id: string;
  event_type: string;
  channel: string;
  status: string;
  recipient_phone?: string | null;
  recipient_email?: string | null;
  recipient?: string;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
};

const STATUS_CONFIG: Record<NotificationEventItem['status'], { label: string; classes: string }> = {
  sent: { label: 'Sent', classes: 'bg-green-50 text-green-700 border-green-300' },
  pending: { label: 'Pending', classes: 'bg-amber-50 text-amber-700 border-amber-300' },
  processing: { label: 'Processing', classes: 'bg-blue-50 text-blue-700 border-blue-300' },
  failed: { label: 'Failed', classes: 'bg-red-50 text-red-700 border-red-300' },
  cancelled: { label: 'Cancelled', classes: 'bg-slate-50 text-slate-600 border-slate-300' },
};

const EVENT_TYPE_OPTIONS = [
  'appointment.pending_confirmation',
  'appointment.confirmed',
  'appointment.cancelled',
  'appointment.rescheduled',
  'appointment.reminder',
  'staff.pending_appointment',
  'staff.action_request',
  'staff.callback_request',
  'staff.emergency_alert',
  'patient.otp',
];

function formatTimestamp(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mapNotification(row: ApiNotificationRow): NotificationEventItem {
  const status = (
    ['pending', 'processing', 'sent', 'failed', 'cancelled'].includes(row.status)
      ? row.status
      : 'pending'
  ) as NotificationEventItem['status'];

  return {
    id: row.id,
    createdAt: row.created_at,
    clinicName: row.clinic_id,
    eventType: row.event_type,
    channel: row.channel,
    recipient: row.recipient ?? row.recipient_phone ?? row.recipient_email ?? '—',
    status,
    attempts: row.attempt_count,
    lastError: row.last_error,
    providerMessageId: null,
    payload: {},
  };
}

function PayloadModal({
  payload,
  onClose,
}: {
  payload: Record<string, unknown>;
  onClose: () => void;
}) {
  const masked = { ...payload };
  if ('otp' in masked) masked.otp = '******';
  if ('patient_phone' in masked) masked.patient_phone = '***masked***';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Notification payload</h3>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
        <pre className="overflow-auto rounded-xl bg-slate-900 p-4 text-xs text-green-400">
          {JSON.stringify(masked, null, 2)}
        </pre>
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-800">
            Sensitive fields (otp, patient_phone) are masked.
          </p>
        </div>
      </div>
    </div>
  );
}

export function NotificationEventsList() {
  const isPlatformAdmin = useIsPlatformAdmin();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<NotificationEventItem[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterEventType, setFilterEventType] = useState<string>('all');
  const [filterClinic, setFilterClinic] = useState<string>('all');
  const [payloadModal, setPayloadModal] = useState<Record<string, unknown> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleRetry = async (notificationId: string) => {
    setActionError(null);
    try {
      await retryPlatformNotification(notificationId);
      await loadEvents();
    } catch (err) {
      setActionError(
        err instanceof ApiRequestError ? err.apiError.message : 'Failed to retry notification.',
      );
    }
  };

  const handleCancel = async (notificationId: string) => {
    setActionError(null);
    try {
      await cancelPlatformNotification(notificationId);
      await loadEvents();
    } catch (err) {
      setActionError(
        err instanceof ApiRequestError ? err.apiError.message : 'Failed to cancel notification.',
      );
    }
  };

  const loadEvents = useCallback(async () => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchPlatformNotifications();
      setEvents((rows as ApiNotificationRow[]).map(mapNotification));
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.apiError.message
          : 'Failed to load notification events.',
      );
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  if (!isPlatformAdmin) {
    return (
      <>
        <PageHeader title="Notification events" description="Monitor notification delivery status across clinics." />
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Access denied. Platform admin only.</p>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Notification events" description="Monitor notification delivery status across clinics." />
        <LoadingState title="Loading notification events" description="Fetching from the platform API." />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Notification events" description="Monitor notification delivery status across clinics." />
        <ErrorState title="Could not load notification events" description={error}>
          <button
            type="button"
            onClick={() => void loadEvents()}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white"
          >
            Retry
          </button>
        </ErrorState>
      </>
    );
  }

  const clinics = [...new Set(events.map((e) => e.clinicName))];

  const filtered = events.filter((e) => {
    if (filterStatus !== 'all' && e.status !== filterStatus) return false;
    if (filterEventType !== 'all' && e.eventType !== filterEventType) return false;
    if (filterClinic !== 'all' && e.clinicName !== filterClinic) return false;
    return true;
  });

  return (
    <>
      <PageHeader
        title="Notification events"
        description="Monitor notification delivery status across clinics."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {actionError && (
          <p className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
            {actionError}
          </p>
        )}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          value={filterEventType}
          onChange={(e) => setFilterEventType(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
        >
          <option value="all">All event types</option>
          {EVENT_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          value={filterClinic}
          onChange={(e) => setFilterClinic(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
        >
          <option value="all">All clinics</option>
          {clinics.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <span className="text-xs font-semibold text-slate-500">
          {filtered.length} of {events.length} events
        </span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Created at
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Clinic
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Event type
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Channel
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Recipient
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Attempts
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Last error
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Provider msg ID
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((evt) => {
                const statusCfg = STATUS_CONFIG[evt.status] ?? STATUS_CONFIG.pending;
                return (
                  <tr key={evt.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-700">
                      {formatTimestamp(evt.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                      {evt.clinicName}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">
                      {evt.eventType}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-bold capitalize text-slate-700">
                        {evt.channel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                      {evt.recipient}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${statusCfg.classes}`}
                      >
                        {statusCfg.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                      {evt.attempts}
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-3 text-xs text-red-600">
                      {evt.lastError ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">
                      {evt.providerMessageId ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex gap-1.5">
                        {(evt.status === 'failed' || evt.status === 'pending') && (
                          <button
                            onClick={() => void handleRetry(evt.id)}
                            className="rounded-lg border border-teal-300 bg-teal-50 px-2 py-1 text-xs font-bold text-teal-700 hover:bg-teal-100"
                          >
                            Retry
                          </button>
                        )}
                        {evt.status !== 'sent' && evt.status !== 'cancelled' && (
                          <button
                            onClick={() => void handleCancel(evt.id)}
                            className="rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          onClick={() => setPayloadModal(evt.payload)}
                          className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100"
                        >
                          Payload
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-400">
                    No notification events match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {payloadModal && (
        <PayloadModal payload={payloadModal} onClose={() => setPayloadModal(null)} />
      )}
    </>
  );
}
