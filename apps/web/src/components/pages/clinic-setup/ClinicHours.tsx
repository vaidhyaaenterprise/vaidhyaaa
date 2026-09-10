'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { fetchClinicHours, replaceClinicHours } from '@/lib/api/clinic-clinical';
import { previewClinicHours } from '@/lib/api/clinic-subscription';
import { conflictsFromApiError, formatScheduleConflicts } from '@/lib/api/conflict-helpers';
import { dayLabel, dayNumber } from '@/lib/clinic-scheduling';

type TimeSlot = {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  active: boolean;
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function ClinicHours() {
  const { effectiveRole } = useAuth();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';

  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [clinicHours, setClinicHours] = useState<TimeSlot[]>([]);
  const [tempHours, setTempHours] = useState<TimeSlot[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);

  const loadHours = useCallback(async () => {
    if (!clinicId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await fetchClinicHours(clinicId);
      const mapped = rows.map((row) => ({
        id: row.id,
        day: dayLabel(row.day_of_week),
        startTime: row.start_time,
        endTime: row.end_time,
        active: row.active,
      }));
      setClinicHours(mapped);
      setTempHours(mapped);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadHours();
  }, [loadHours]);

  const handleEdit = () => {
    setTempHours(clinicHours);
    setConflicts([]);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setConflicts([]);
  };

  const handleSave = async () => {
    if (!clinicId) {
      return;
    }

    const windows = tempHours
      .filter((slot) => slot.active)
      .map((slot) => ({
        day_of_week: dayNumber(slot.day),
        start_time: slot.startTime,
        end_time: slot.endTime,
        active: true,
      }));

    try {
      const preview = await previewClinicHours(clinicId, windows);
      if (preview.blocked) {
        setConflicts(formatScheduleConflicts(preview.conflicts));
        return;
      }
      await replaceClinicHours(clinicId, windows);
    } catch (err) {
      const apiConflicts = conflictsFromApiError(err);
      if (apiConflicts) {
        setConflicts(apiConflicts);
        return;
      }
      throw err;
    }

    setIsEditing(false);
    setConflicts([]);
    await loadHours();
  };

  const addTimeSlot = (day: string) => {
    const newSlot: TimeSlot = {
      id: Date.now().toString(),
      day,
      startTime: '09:00',
      endTime: '13:00',
      active: true,
    };
    setTempHours([...tempHours, newSlot]);
  };

  const removeTimeSlot = (id: string) => {
    setTempHours(tempHours.filter(h => h.id !== id));
  };

  const updateTimeSlot = (id: string, field: keyof TimeSlot, value: string) => {
    setTempHours(tempHours.map(h => h.id === id ? { ...h, [field]: value } : h));
  };


  const getHoursForDay = (day: string) => {
    return clinicHours.filter(h => h.day === day && h.active);
  };

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Clinic working hours</h3>
        </div>
        <p className="text-sm text-slate-500">Only admins can edit clinic hours.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <LoadingState title="Loading clinic hours" description="Fetching from the API." />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-900">Clinic working hours</h3>
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
        <div className="space-y-2">
          {DAYS.map((day) => {
            const dayHours = getHoursForDay(day);
            if (dayHours.length === 0) return null;
            
            return (
              <div key={day} className="flex justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                <span className="w-24 font-bold text-slate-900">{day}</span>
                <span className="text-sm text-slate-600">
                  {dayHours.map(h => `${h.startTime} - ${h.endTime}`).join(', ')}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {conflicts.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <h4 className="mb-2 text-sm font-bold text-red-800">⚠ Conflicts detected</h4>
              <ul className="space-y-1 text-sm text-red-700">
                {conflicts.map((conflict, idx) => (
                  <li key={idx}>• {conflict}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-red-600">Please resolve conflicts before saving.</p>
            </div>
          )}

          <div className="space-y-3">
            {DAYS.map((day) => {
              const daySlots = tempHours.filter(h => h.day === day);
              
              return (
                <div key={day} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-bold text-slate-900">{day}</span>
                    <button
                      onClick={() => addTimeSlot(day)}
                      className="rounded-lg border border-green-300 bg-green-50 px-2 py-1 text-xs font-bold text-green-700 hover:bg-green-100"
                    >
                      + Add slot
                    </button>
                  </div>
                  {daySlots.length === 0 ? (
                    <p className="text-sm text-slate-500">No hours set</p>
                  ) : (
                    <div className="space-y-2">
                      {daySlots.map((slot) => (
                        <div key={slot.id} className="flex gap-2">
                          <input
                            type="time"
                            value={slot.startTime}
                            onChange={(e) => updateTimeSlot(slot.id, 'startTime', e.target.value)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                          />
                          <span className="py-1.5 text-slate-500">to</span>
                          <input
                            type="time"
                            value={slot.endTime}
                            onChange={(e) => updateTimeSlot(slot.id, 'endTime', e.target.value)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                          />
                          <button
                            onClick={() => removeTimeSlot(slot.id)}
                            className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void handleSave()}
              disabled={conflicts.length > 0}
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
