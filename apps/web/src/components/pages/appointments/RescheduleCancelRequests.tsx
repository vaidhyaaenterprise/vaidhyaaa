'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import type { AppointmentActionRequest, AppointmentActivity } from './types';

interface RescheduleCancelRequestsProps {
  requests: AppointmentActionRequest[];
  activities: AppointmentActivity[];
  onApproveReschedule: (requestId: string, newDate: string, newTime: string) => Promise<void>;
  onRejectRequest: (requestId: string) => Promise<void>;
  onCancelAppointment: (requestId: string) => Promise<void>;
}

export function RescheduleCancelRequests({
  requests,
  activities,
  onApproveReschedule,
  onRejectRequest,
  onCancelAppointment,
}: RescheduleCancelRequestsProps) {
  const { effectiveRole } = useAuth();
  const isAdmin = effectiveRole === 'admin';

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-lg font-bold text-slate-900">Reschedule / cancel requests</h3>
        <p className="text-sm text-slate-500">Only admins can view reschedule/cancel requests.</p>
      </div>
    );
  }

  const groupedRequests = requests.reduce((acc, request) => {
    if (!acc[request.doctorId]) {
      acc[request.doctorId] = {
        doctorName: request.doctorName,
        requests: [],
      };
    }
    acc[request.doctorId]?.requests.push(request);
    return acc;
  }, {} as Record<string, { doctorName: string; requests: AppointmentActionRequest[] }>);

  if (requests.length === 0 && activities.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-lg font-bold text-slate-900">Reschedule / cancel requests</h3>
        <p className="text-sm text-slate-500">No pending requests or recent changes</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-bold text-slate-900">Reschedule / cancel requests</h3>
      {requests.length > 0 ? (
        <section aria-labelledby="pending-appointment-requests-heading" className="mb-5">
          <h4
            id="pending-appointment-requests-heading"
            className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-700"
          >
            Pending requests
          </h4>
          <div className="space-y-4">
            {Object.entries(groupedRequests).map(([doctorId, group]) => (
              <div key={doctorId} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h5 className="mb-3 text-sm font-bold text-slate-700">{group.doctorName}</h5>
                <div className="space-y-3">
                  {group.requests.map((request) => (
                    <RequestCard
                      key={request.id}
                      request={request}
                      onApproveReschedule={onApproveReschedule}
                      onRejectRequest={onRejectRequest}
                      onCancelAppointment={onCancelAppointment}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="mb-5 text-sm text-slate-500">No pending requests</p>
      )}

      <section aria-labelledby="appointment-activity-heading">
        <h4
          id="appointment-activity-heading"
          className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-700"
        >
          Recent changes
        </h4>
        {activities.length === 0 ? (
          <p className="text-sm text-slate-500">No completed reschedules or cancellations</p>
        ) : (
          <ul className="space-y-3">
            {activities.map((activity) => (
              <ActivityCard key={activity.id} activity={activity} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatActivityDate(date: string) {
  const [year, month, day] = date.split('-');
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function formatActivityTime(time: string) {
  const [hours, minutes] = time.split(':');
  const hour = Number.parseInt(hours ?? '0', 10);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${minutes ?? '00'} ${suffix}`;
}

function ActivityCard({ activity }: { activity: AppointmentActivity }) {
  const previousStart = activity.previousAppointmentDate
    ? `${formatActivityDate(activity.previousAppointmentDate)} at ${formatActivityTime(activity.previousAppointmentTime)}`
    : '';
  const currentStart = activity.appointmentDate
    ? `${formatActivityDate(activity.appointmentDate)} at ${formatActivityTime(activity.appointmentTime)}`
    : '';

  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-bold text-slate-900">{activity.patientName}</p>
          {activity.patientPhone ? (
            <p className="mt-0.5 text-sm text-slate-600">{activity.patientPhone}</p>
          ) : null}
          <p className="mt-1 text-sm text-slate-700">
            {activity.doctorName} · {activity.serviceName}
          </p>
          {activity.reasonForVisit ? (
            <p className="mt-1 text-sm text-slate-600">{activity.reasonForVisit}</p>
          ) : null}
          {activity.actionType === 'reschedule' ? (
            <div className="mt-2 text-xs text-slate-600">
              {previousStart ? <p>Previous: {previousStart}</p> : null}
              {currentStart ? <p>New: {currentStart}</p> : null}
            </div>
          ) : currentStart ? (
            <p className="mt-2 text-xs text-slate-600">Appointment: {currentStart}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <span
            className={`rounded-full border-2 px-3 py-1 text-xs font-bold ${
              activity.actionType === 'reschedule'
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-red-300 bg-red-50 text-red-700'
            }`}
          >
            {activity.actionType === 'reschedule' ? 'Rescheduled' : 'Cancelled'}
          </span>
          <time dateTime={activity.occurredAt} className="text-xs text-slate-500">
            {new Date(activity.occurredAt).toLocaleString()}
          </time>
        </div>
      </div>
    </li>
  );
}

interface RequestCardProps {
  request: AppointmentActionRequest;
  onApproveReschedule: (requestId: string, newDate: string, newTime: string) => Promise<void>;
  onRejectRequest: (requestId: string) => Promise<void>;
  onCancelAppointment: (requestId: string) => Promise<void>;
}

function exactTimeInputValue(value: string): string {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? `${match[1]}:${match[2]}` : '';
}

function RequestCard({
  request,
  onApproveReschedule,
  onRejectRequest,
  onCancelAppointment,
}: RequestCardProps) {
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [newDate, setNewDate] = useState(request.requestedDate);
  const [newTime, setNewTime] = useState(() => exactTimeInputValue(request.requestedTime));
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (action: () => Promise<void>, closeEditor = false) => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      await action();
      if (closeEditor) {
        setIsRescheduling(false);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to update this request.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApproveReschedule = async () => {
    if (newDate && newTime) {
      await runAction(() => onApproveReschedule(request.id, newDate, newTime), true);
    }
  };

  const handleApproveRequestedSlot = async () => {
    await runAction(() =>
      onApproveReschedule(request.id, request.requestedDate, request.requestedTime),
    );
  };

  const handleApproveCancellation = async () => {
    await runAction(() => onCancelAppointment(request.id));
  };

  const handleRejectRequest = async () => {
    await runAction(() => onRejectRequest(request.id), true);
  };

  const closeRescheduleEditor = () => {
    if (!isSaving) {
      setIsRescheduling(false);
      setNewDate(request.requestedDate);
      setNewTime(exactTimeInputValue(request.requestedTime));
      setActionError(null);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex-1">
          <h4 className="text-base font-bold text-slate-900">{request.patientName}</h4>
          <p className="text-sm text-slate-600">{request.doctorName} · {request.serviceName}</p>
          <p className="mt-1 text-sm text-slate-700">{request.reason}</p>
        </div>
        <span className={`rounded-full border-2 px-3 py-1 text-xs font-bold uppercase tracking-wider ${
          request.actionType === 'reschedule'
            ? 'border-amber-300 bg-amber-50 text-amber-700'
            : 'border-red-300 bg-red-50 text-red-700'
        }`}>
          {request.actionType}
        </span>
      </div>

      <p className="mb-3 text-xs text-red-600 font-semibold">
        ⚠ Exceeds 1 hr threshold — reschedule only if the new slot is free, otherwise cancel.
      </p>

      {!isRescheduling ? (
        <div className="flex flex-wrap gap-2">
          {request.actionType === 'reschedule' && (
            <>
              {request.requestedNewSlotId ? (
                <button
                  onClick={() => void handleApproveRequestedSlot()}
                  disabled={isSaving}
                  className="rounded-xl bg-teal-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-800 disabled:cursor-wait disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : 'Approve requested slot'}
                </button>
              ) : null}
              <button
                onClick={() => setIsRescheduling(true)}
                disabled={isSaving}
                className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-50"
              >
                Choose another slot
              </button>
            </>
          )}
          {request.actionType === 'cancel' ? (
            <button
              onClick={() => void handleApproveCancellation()}
              disabled={isSaving}
              className="rounded-xl border-2 border-red-300 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:cursor-wait disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Approve cancellation'}
            </button>
          ) : null}
          <button
            onClick={() => void handleRejectRequest()}
            disabled={isSaving}
            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-50"
          >
            Reject request
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`reschedule-date-${request.id}`}
                className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500"
              >
                New date
              </label>
              <input
                id={`reschedule-date-${request.id}`}
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              />
            </div>
            <div>
              <label
                htmlFor={`reschedule-time-${request.id}`}
                className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500"
              >
                New time
              </label>
              <input
                id={`reschedule-time-${request.id}`}
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              />
              {!newTime && request.requestedTime ? (
                <p className="mt-1 text-xs text-slate-500">
                  Requested preference: {request.requestedTime}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void handleApproveReschedule()}
              disabled={isSaving || !newDate || !newTime}
              className="rounded-xl bg-teal-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving…' : 'Save reschedule'}
            </button>
            <button
              onClick={closeRescheduleEditor}
              disabled={isSaving}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              Close
            </button>
            <button
              onClick={() => void handleRejectRequest()}
              disabled={isSaving}
              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-50"
            >
              Reject request
            </button>
          </div>
        </div>
      )}
      {actionError ? (
        <p role="alert" className="mt-3 text-xs font-semibold text-red-600">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
