'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import type { Appointment, BookingRules } from './types';

interface AppointmentCardProps {
  appointment: Appointment;
  bookingRules: BookingRules;
  onConfirm?: (id: string) => void;
  onEditTime?: (id: string, newTime: string) => void;
  onCancel?: (id: string) => void;
  onMarkVisited?: (id: string, visitReason: string) => void;
  onViewHistory?: (patientPhone: string) => void;
}

export function AppointmentCard({
  appointment,
  bookingRules,
  onConfirm,
  onEditTime,
  onCancel,
  onMarkVisited,
  onViewHistory,
}: AppointmentCardProps) {
  const { effectiveRole, me } = useAuth();
  const isAdmin = effectiveRole === 'admin';
  const currentDoctorId = me?.clinics[0]?.doctor_id;
  const isOwnAppointment = currentDoctorId ? currentDoctorId === appointment.doctorId : false;
  
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [editedTime, setEditedTime] = useState(appointment.appointmentTime);
  const [isMarkingVisited, setIsMarkingVisited] = useState(false);
  const [visitReason, setVisitReason] = useState('');

  const canEdit = isAdmin || (isOwnAppointment && bookingRules.allowDoctorServiceEdit);
  const canConfirm = isAdmin || isOwnAppointment;
  const canMarkVisited = isAdmin || isOwnAppointment;

  const handleConfirm = () => {
    if (onConfirm && canConfirm) {
      onConfirm(appointment.id);
    }
  };

  const handleEditTimeSave = () => {
    if (onEditTime && canEdit) {
      onEditTime(appointment.id, editedTime);
      setIsEditingTime(false);
    }
  };

  const handleMarkVisitedSave = () => {
    if (onMarkVisited && canMarkVisited && visitReason.trim()) {
      onMarkVisited(appointment.id, visitReason);
      setIsMarkingVisited(false);
      setVisitReason('');
    }
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours ?? '0', 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const formattedHour = hour % 12 || 12;
    return `${formattedHour}:${minutes ?? '00'} ${ampm}`;
  };

  const getStatusBadge = () => {
    switch (appointment.status) {
      case 'pending_confirmation':
        return <span className="rounded-full border-2 border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">Pending</span>;
      case 'confirmed':
        return <span className="rounded-full border-2 border-green-300 bg-green-50 px-3 py-1 text-xs font-bold text-green-700">Confirmed</span>;
      case 'visited':
        return <span className="rounded-full border-2 border-blue-300 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">Visited</span>;
      case 'cancelled':
        return <span className="rounded-full border-2 border-red-300 bg-red-50 px-3 py-1 text-xs font-bold text-red-700">Cancelled</span>;
      default:
        return null;
    }
  };

  const getVisitTypeBadge = () => {
    return (
      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
        appointment.visitType === 'new' 
          ? 'border-purple-300 bg-purple-50 text-purple-700' 
          : 'border-teal-300 bg-teal-50 text-teal-700'
      }`}>
        {appointment.visitType === 'new' ? 'New' : 'Follow-up'}
      </span>
    );
  };

  const getSourceBadge = () => {
    return (
      <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
        {appointment.source === 'agent' ? 'Bot' : appointment.source === 'manual' ? 'Manual' : 'Admin'}
      </span>
    );
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-2 flex-wrap">
            <h4 className="text-base font-bold text-slate-900">{appointment.patientName}</h4>
            {getVisitTypeBadge()}
            {getSourceBadge()}
          </div>
          <p className="text-sm text-slate-600">{appointment.patientPhone}</p>
          <p className="mt-1 text-sm text-slate-700">
            <span className="font-semibold">{appointment.doctorName}</span> · {appointment.serviceName}
          </p>
          <p className="mt-1 text-sm text-slate-600">{appointment.reasonForVisit}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-right">
            <p className="text-lg font-bold text-slate-900">{formatTime(appointment.appointmentTime)}</p>
            <p className="text-xs text-slate-500">{appointment.appointmentDate}</p>
          </div>
          {getStatusBadge()}
        </div>
      </div>

      {appointment.hasHistory && (
        <button
          onClick={() => onViewHistory?.(appointment.patientPhone)}
          className="mb-3 text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline"
        >
          View patient history →
        </button>
      )}

      {appointment.overrideReason && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2">
          <p className="text-xs font-bold text-amber-800">Override: {appointment.overrideReason}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {appointment.status === 'pending_confirmation' && canConfirm && (
          <button
            onClick={handleConfirm}
            className="rounded-xl border-2 border-green-300 bg-green-50 px-3 py-1.5 text-xs font-bold text-green-700 hover:bg-green-100"
          >
            Confirm
          </button>
        )}

        {appointment.status === 'confirmed' && canMarkVisited && (
          <button
            onClick={() => setIsMarkingVisited(true)}
            className="rounded-xl border-2 border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100"
          >
            ✓ Mark Visited
          </button>
        )}

        {appointment.status === 'confirmed' && canEdit && (
          <button
            onClick={() => setIsEditingTime(true)}
            className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100"
          >
            Edit Time
          </button>
        )}

        {(appointment.status === 'pending_confirmation' || appointment.status === 'confirmed') && isAdmin && (
          <button
            onClick={() => onCancel?.(appointment.id)}
            className="rounded-xl border-2 border-red-300 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
          >
            Cancel
          </button>
        )}
      </div>

      {isEditingTime && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center gap-2">
            <input
              type="time"
              value={editedTime}
              onChange={(e) => setEditedTime(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
            />
            <button
              onClick={handleEditTimeSave}
              className="rounded-lg border-2 border-green-300 bg-green-50 px-3 py-1.5 text-xs font-bold text-green-700 hover:bg-green-100"
            >
              Save
            </button>
            <button
              onClick={() => {
                setIsEditingTime(false);
                setEditedTime(appointment.appointmentTime);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-slate-500">
            ⏱ Edit available within {bookingRules.manualEditCutoffBeforeStartMinutes} min of appointment. 
            Max shift: {bookingRules.manualEditMaxShiftMinutes} min.
          </p>
        </div>
      )}

      {isMarkingVisited && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <textarea
            value={visitReason}
            onChange={(e) => setVisitReason(e.target.value)}
            placeholder="Enter visit reason (required)..."
            className="mb-2 w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={handleMarkVisitedSave}
              disabled={!visitReason.trim()}
              className="rounded-xl bg-teal-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save Visit
            </button>
            <button
              onClick={() => {
                setIsMarkingVisited(false);
                setVisitReason('');
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
