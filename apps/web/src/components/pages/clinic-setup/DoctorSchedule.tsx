'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import {
  fetchDoctorSchedules,
  fetchDoctors,
  replaceDoctorSchedules,
} from '@/lib/api/clinic-clinical';
import { dayLabel, dayNumber } from '@/lib/clinic-scheduling';

type DoctorScheduleSlot = {
  id: string;
  doctorId: string;
  day: string;
  startTime: string;
  endTime: string;
  active: boolean;
};

type DoctorOption = {
  id: string;
  name: string;
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function normalizeTime(value: string): string {
  return value.slice(0, 5);
}

export function DoctorSchedule() {
  const { effectiveRole, me } = useAuth();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('all');
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [schedules, setSchedules] = useState<DoctorScheduleSlot[]>([]);
  const [tempSchedules, setTempSchedules] = useState<DoctorScheduleSlot[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);

  const currentDoctorId = isAdmin ? selectedDoctorId : me?.clinics[0]?.doctor_id || null;

  const loadSchedules = useCallback(async () => {
    if (!clinicId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const doctorRows = await fetchDoctors(clinicId);
      const doctorOptions = doctorRows
        .filter((row) => row.active)
        .map((row) => ({ id: row.id, name: row.name }));
      setDoctors(doctorOptions);

      const scheduleRows = await Promise.all(
        doctorOptions.map(async (doctor) => {
          const rows = await fetchDoctorSchedules(clinicId, doctor.id);
          return rows.map((row) => ({
            id: row.id,
            doctorId: row.doctor_id,
            day: dayLabel(row.day_of_week),
            startTime: normalizeTime(row.start_time),
            endTime: normalizeTime(row.end_time),
            active: row.active,
          }));
        }),
      );
      const mapped = scheduleRows.flat();
      setSchedules(mapped);
      setTempSchedules(mapped);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.apiError.message : 'Failed to load doctor schedules.',
      );
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  const handleEdit = () => {
    setTempSchedules(schedules);
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
    const doctorId =
      currentDoctorId && currentDoctorId !== 'all'
        ? currentDoctorId
        : doctors[0]?.id;
    if (!doctorId) {
      return;
    }

    const detectedConflicts = detectConflicts();
    if (detectedConflicts.length > 0) {
      setConflicts(detectedConflicts);
      return;
    }

    const windows = tempSchedules
      .filter((slot) => slot.doctorId === doctorId && slot.active)
      .map((slot) => ({
        day_of_week: dayNumber(slot.day),
        start_time: slot.startTime,
        end_time: slot.endTime,
        active: true,
      }));

    await replaceDoctorSchedules(clinicId, doctorId, windows);
    setIsEditing(false);
    setConflicts([]);
    await loadSchedules();
  };

  const detectConflicts = (): string[] => {
    return [];
  };

  const addScheduleSlot = (day: string) => {
    const doctorId =
      currentDoctorId && currentDoctorId !== 'all'
        ? currentDoctorId
        : doctors[0]?.id;
    if (!doctorId) {
      return;
    }

    const newSlot: DoctorScheduleSlot = {
      id: `new-${Date.now()}`,
      doctorId,
      day,
      startTime: '09:00',
      endTime: '13:00',
      active: true,
    };
    setTempSchedules([...tempSchedules, newSlot]);
  };

  const removeScheduleSlot = (id: string) => {
    setTempSchedules(tempSchedules.filter((s) => s.id !== id));
  };

  const updateScheduleSlot = (id: string, field: keyof DoctorScheduleSlot, value: string) => {
    setTempSchedules(tempSchedules.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const getScheduleForDoctor = (doctorId: string) => {
    return schedules.filter((s) => s.doctorId === doctorId && s.active);
  };

  const getTempScheduleForDoctor = (doctorId: string) => {
    return tempSchedules.filter((s) => s.doctorId === doctorId);
  };

  const getHoursForDay = (doctorId: string, day: string) => {
    return schedules.filter((s) => s.doctorId === doctorId && s.day === day && s.active);
  };

  const editingDoctorId =
    currentDoctorId && currentDoctorId !== 'all' ? currentDoctorId : doctors[0]?.id ?? '';

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <LoadingState title="Loading doctor schedules" description="Fetching from the API." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <ErrorState title="Could not load doctor schedules" description={error}>
          <button
            type="button"
            onClick={() => void loadSchedules()}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white"
          >
            Retry
          </button>
        </ErrorState>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-900">Doctor schedules</h3>
        {!isEditing && (
          <button
            onClick={handleEdit}
            className="rounded-xl border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100"
          >
            Edit
          </button>
        )}
      </div>

      {isAdmin && (
        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
            Select doctor
          </label>
          <select
            value={selectedDoctorId}
            onChange={(e) => setSelectedDoctorId(e.target.value)}
            className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
          >
            <option value="all">All doctors</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!isEditing ? (
        <div className="space-y-4">
          {selectedDoctorId === 'all' ? (
            doctors.map((doctor) => {
              const doctorSchedule = getScheduleForDoctor(doctor.id);
              if (doctorSchedule.length === 0) return null;

              return (
                <div key={doctor.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h4 className="mb-3 font-bold text-slate-900">{doctor.name}</h4>
                  <div className="space-y-2">
                    {DAYS.map((day) => {
                      const dayHours = getHoursForDay(doctor.id, day);
                      if (dayHours.length === 0) return null;

                      return (
                        <div key={day} className="flex justify-between">
                          <span className="w-24 text-sm font-semibold text-slate-700">{day}</span>
                          <span className="text-sm text-slate-600">
                            {dayHours.map((h) => `${h.startTime} - ${h.endTime}`).join(', ')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="space-y-2">
              {DAYS.map((day) => {
                const dayHours = getHoursForDay(selectedDoctorId, day);
                if (dayHours.length === 0) return null;

                return (
                  <div
                    key={day}
                    className="flex justify-between rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    <span className="w-24 font-bold text-slate-900">{day}</span>
                    <span className="text-sm text-slate-600">
                      {dayHours.map((h) => `${h.startTime} - ${h.endTime}`).join(', ')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
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
              const daySlots = getTempScheduleForDoctor(editingDoctorId).filter(
                (s) => s.day === day,
              );

              return (
                <div key={day} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-bold text-slate-900">{day}</span>
                    <button
                      onClick={() => addScheduleSlot(day)}
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
                            onChange={(e) =>
                              updateScheduleSlot(slot.id, 'startTime', e.target.value)
                            }
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                          />
                          <span className="py-1.5 text-slate-500">to</span>
                          <input
                            type="time"
                            value={slot.endTime}
                            onChange={(e) => updateScheduleSlot(slot.id, 'endTime', e.target.value)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                          />
                          <button
                            onClick={() => removeScheduleSlot(slot.id)}
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
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
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
