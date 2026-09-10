'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import type { AppointmentActionRequest } from './types';

interface RescheduleCancelRequestsProps {
  requests: AppointmentActionRequest[];
  onApproveReschedule: (requestId: string, newDate: string, newTime: string) => void;
  onRejectRequest: (requestId: string) => void;
  onCancelAppointment: (requestId: string) => void;
}

export function RescheduleCancelRequests({
  requests,
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

  if (requests.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-lg font-bold text-slate-900">Reschedule / cancel requests</h3>
        <p className="text-sm text-slate-500">No pending requests</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-bold text-slate-900">Reschedule / cancel requests</h3>
      <div className="space-y-4">
        {Object.entries(groupedRequests).map(([doctorId, group]) => (
          <div key={doctorId} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h4 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-700">
              {group.doctorName}
            </h4>
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
    </div>
  );
}

interface RequestCardProps {
  request: AppointmentActionRequest;
  onApproveReschedule: (requestId: string, newDate: string, newTime: string) => void;
  onRejectRequest: (requestId: string) => void;
  onCancelAppointment: (requestId: string) => void;
}

function RequestCard({
  request,
  onApproveReschedule,
  onRejectRequest: _onRejectRequest,
  onCancelAppointment,
}: RequestCardProps) {
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [newDate, setNewDate] = useState(request.requestedDate);
  const [newTime, setNewTime] = useState(request.requestedTime);

  const handleApproveReschedule = () => {
    if (newDate && newTime) {
      onApproveReschedule(request.id, newDate, newTime);
      setIsRescheduling(false);
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
            <button
              onClick={() => setIsRescheduling(true)}
              className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100"
            >
              Reschedule
            </button>
          )}
          <button
            onClick={() => onCancelAppointment(request.id)}
            className="rounded-xl border-2 border-red-300 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
          >
            Cancel appointment
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                New date
              </label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                New time
              </label>
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleApproveReschedule}
              disabled={!newDate || !newTime}
              className="rounded-xl bg-teal-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save reschedule
            </button>
            <button
              onClick={() => {
                setIsRescheduling(false);
                setNewDate(request.requestedDate);
                setNewTime(request.requestedTime);
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
