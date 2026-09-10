'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import {
  createHoliday,
  fetchDoctors,
  fetchHolidays,
  patchHoliday,
  type HolidayApiRow,
} from '@/lib/api/clinic-clinical';
import { previewHoliday } from '@/lib/api/clinic-subscription';
import { conflictsFromApiError, formatScheduleConflicts } from '@/lib/api/conflict-helpers';

type Holiday = {
  id: string;
  date: string;
  reason: string;
  active: boolean;
  appliesToClinic: boolean;
  doctorIds: string[];
};

type DoctorOption = {
  id: string;
  name: string;
};

function normalizeDoctorIds(doctorIds: string[]): string[] {
  return Array.from(new Set(doctorIds.filter((doctorId) => doctorId.trim().length > 0))).sort();
}

function mapHolidayRow(row: HolidayApiRow): Holiday {
  const doctorIds = normalizeDoctorIds(row.doctor_ids ?? []);
  const appliesToClinic =
    row.applies_to_clinic !== undefined ? row.applies_to_clinic : doctorIds.length === 0;

  return {
    id: row.id,
    date: row.holiday_date,
    reason: row.reason ?? '',
    active: row.active,
    appliesToClinic,
    doctorIds: appliesToClinic ? [] : doctorIds,
  };
}

function holidayPayload(holiday: Holiday): {
  holiday_date: string;
  reason?: string;
  active: boolean;
  doctor_ids?: string[];
} {
  const doctorIds = holiday.appliesToClinic ? [] : normalizeDoctorIds(holiday.doctorIds);

  return {
    holiday_date: holiday.date,
    ...(holiday.reason.trim() ? { reason: holiday.reason.trim() } : {}),
    active: holiday.active,
    doctor_ids: doctorIds,
  };
}

function sameHoliday(left: Holiday, right: Holiday): boolean {
  return (
    left.date === right.date &&
    left.reason.trim() === right.reason.trim() &&
    left.active === right.active &&
    left.appliesToClinic === right.appliesToClinic &&
    normalizeDoctorIds(left.doctorIds).join(',') === normalizeDoctorIds(right.doctorIds).join(',')
  );
}

export function HolidaySetup() {
  const { effectiveRole } = useAuth();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [tempHolidays, setTempHolidays] = useState<Holiday[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);

  const doctorNameById = useMemo(
    () => new Map(doctors.map((doctor) => [doctor.id, doctor.name])),
    [doctors],
  );

  const loadHolidays = useCallback(async () => {
    if (!isAdmin || !clinicId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [holidayRows, doctorRows] = await Promise.all([
        fetchHolidays(clinicId),
        fetchDoctors(clinicId),
      ]);

      const mappedDoctors = doctorRows
        .filter((doctor) => doctor.active)
        .map((doctor) => ({ id: doctor.id, name: doctor.name }));

      const mappedHolidays = holidayRows
        .map(mapHolidayRow)
        .filter((holiday) => holiday.active)
        .sort((left, right) => left.date.localeCompare(right.date));

      setDoctors(mappedDoctors);
      setHolidays(mappedHolidays);
      setTempHolidays(mappedHolidays);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.apiError.message : 'Failed to load holidays.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, clinicId]);

  useEffect(() => {
    void loadHolidays();
  }, [loadHolidays]);

  const handleEdit = () => {
    setTempHolidays(holidays);
    setConflicts([]);
    setError(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setConflicts([]);
  };

  const validateHoliday = (holiday: Holiday): string | null => {
    if (!holiday.date) {
      return 'Choose a holiday date for each row before saving.';
    }
    if (!holiday.appliesToClinic && holiday.doctorIds.length === 0) {
      return 'Pick at least one doctor when a holiday is not marked as whole-clinic.';
    }
    return null;
  };

  const previewHolidayChange = async (holiday: Holiday) => {
    if (!clinicId || !holiday.active) {
      return;
    }

    const payload = holidayPayload(holiday);
    const previewPayload: { holiday_date: string; doctor_ids?: string[] } = {
      holiday_date: payload.holiday_date,
      ...(payload.doctor_ids !== undefined ? { doctor_ids: payload.doctor_ids } : {}),
    };
    const preview = await previewHoliday(clinicId, previewPayload);
    if (preview.blocked) {
      setConflicts(formatScheduleConflicts(preview.conflicts));
      throw new Error('conflicts_detected');
    }
  };

  const handleSave = async () => {
    if (!clinicId) {
      return;
    }

    setError(null);
    setConflicts([]);

    try {
      for (const holiday of tempHolidays) {
        const validationError = validateHoliday(holiday);
        if (validationError) {
          setError(validationError);
          return;
        }
      }

      const existingById = new Map(holidays.map((holiday) => [holiday.id, holiday]));
      const tempIds = new Set(tempHolidays.map((holiday) => holiday.id));

      for (const holiday of holidays) {
        if (!tempIds.has(holiday.id)) {
          await patchHoliday(clinicId, holiday.id, { active: false });
        }
      }

      for (const holiday of tempHolidays) {
        const original = existingById.get(holiday.id);
        const payload = holidayPayload(holiday);

        if (!original) {
          await previewHolidayChange(holiday);
          await createHoliday(clinicId, payload);
          continue;
        }

        if (sameHoliday(original, holiday)) {
          continue;
        }

        await previewHolidayChange(holiday);
        await patchHoliday(clinicId, holiday.id, payload);
      }

      setIsEditing(false);
      setConflicts([]);
      await loadHolidays();
    } catch (err) {
      if (err instanceof Error && err.message === 'conflicts_detected') {
        return;
      }

      const apiConflicts = conflictsFromApiError(err);
      if (apiConflicts) {
        setConflicts(apiConflicts);
        return;
      }

      setError(err instanceof ApiRequestError ? err.apiError.message : 'Failed to save holidays.');
    }
  };

  const addHoliday = () => {
    const newHoliday: Holiday = {
      id: `new-${Date.now()}`,
      date: '',
      reason: '',
      active: true,
      appliesToClinic: true,
      doctorIds: [],
    };
    setTempHolidays([...tempHolidays, newHoliday]);
  };

  const removeHoliday = (id: string) => {
    setTempHolidays(tempHolidays.filter((holiday) => holiday.id !== id));
  };

  const updateHoliday = (id: string, patch: Partial<Holiday>) => {
    setTempHolidays((prev) => prev.map((holiday) => (holiday.id === id ? { ...holiday, ...patch } : holiday)));
  };

  const toggleDoctorSelection = (holidayId: string, doctorId: string) => {
    const holiday = tempHolidays.find((item) => item.id === holidayId);
    if (!holiday) {
      return;
    }
    const selected = new Set(holiday.doctorIds);
    if (selected.has(doctorId)) {
      selected.delete(doctorId);
    } else {
      selected.add(doctorId);
    }
    updateHoliday(holidayId, { doctorIds: Array.from(selected) });
  };

  const toggleHolidayActive = async (id: string) => {
    if (!clinicId) {
      return;
    }
    const holiday = holidays.find((item) => item.id === id);
    if (!holiday) {
      return;
    }

    await patchHoliday(clinicId, id, { active: !holiday.active });
    await loadHolidays();
  };

  const scopeLabel = (holiday: Holiday): string => {
    if (holiday.appliesToClinic) {
      return 'Whole clinic';
    }
    const names = normalizeDoctorIds(holiday.doctorIds)
      .map((doctorId) => doctorNameById.get(doctorId) ?? 'Unknown doctor')
      .join(', ');
    return names ? `Doctors: ${names}` : 'Doctors: none selected';
  };

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Holiday setup</h3>
        </div>
        <p className="text-sm text-slate-500">Only admins can manage holidays.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <LoadingState title="Loading holidays" description="Fetching from the API." />
      </div>
    );
  }

  if (error && !isEditing) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <ErrorState title="Could not load holidays" description={error}>
          <button
            type="button"
            onClick={() => void loadHolidays()}
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
        <h3 className="text-lg font-bold text-slate-900">Holiday setup</h3>
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
          {holidays.length === 0 ? (
            <p className="text-sm text-slate-500">No holidays configured</p>
          ) : (
            holidays
              .filter((holiday) => holiday.active)
              .sort((left, right) => left.date.localeCompare(right.date))
              .map((holiday) => (
                <div
                  key={holiday.id}
                  className="flex justify-between rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div>
                    <p className="font-bold text-slate-900">
                      {new Date(holiday.date).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                    <p className="text-sm text-slate-500">{holiday.reason || 'No reason set'}</p>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {scopeLabel(holiday)}
                    </p>
                  </div>
                  <button
                    onClick={() => void toggleHolidayActive(holiday.id)}
                    className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
                  >
                    Disable
                  </button>
                </div>
              ))
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}

          {conflicts.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <h4 className="mb-2 text-sm font-bold text-red-800">Conflicts detected</h4>
              <ul className="space-y-1 text-sm text-red-700">
                {conflicts.map((conflict, idx) => (
                  <li key={idx}>- {conflict}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-red-600">Please resolve conflicts before saving.</p>
            </div>
          )}

          <div className="space-y-3">
            {tempHolidays.map((holiday) => (
              <div key={holiday.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-3 flex flex-wrap gap-2">
                  <input
                    type="date"
                    value={holiday.date}
                    onChange={(event) => updateHoliday(holiday.id, { date: event.target.value })}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                  />
                  <input
                    type="text"
                    value={holiday.reason}
                    onChange={(event) => updateHoliday(holiday.id, { reason: event.target.value })}
                    placeholder="Reason"
                    className="min-w-[220px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                  />
                  <button
                    onClick={() => removeHoliday(holiday.id)}
                    className="rounded-lg border border-red-200 bg-red-50 px-2 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                  >
                    Remove
                  </button>
                </div>

                <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={holiday.appliesToClinic}
                    onChange={(event) =>
                      updateHoliday(holiday.id, {
                        appliesToClinic: event.target.checked,
                        ...(event.target.checked ? { doctorIds: [] } : {}),
                      })
                    }
                  />
                  Applies to whole clinic
                </label>

                {!holiday.appliesToClinic && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                      Select doctors
                    </p>
                    {doctors.length === 0 ? (
                      <p className="text-sm text-slate-500">No active doctors available.</p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {doctors.map((doctor) => (
                          <label key={doctor.id} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={holiday.doctorIds.includes(doctor.id)}
                              onChange={() => toggleDoctorSelection(holiday.id, doctor.id)}
                            />
                            {doctor.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={addHoliday}
            className="rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-bold text-green-700 hover:bg-green-100"
          >
            + Add holiday
          </button>

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
