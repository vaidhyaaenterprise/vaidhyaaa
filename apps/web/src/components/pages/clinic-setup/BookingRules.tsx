'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import {
  fetchBookingRules,
  fetchDoctors,
  patchBookingRule,
  type BookingRuleApiRow,
  type BookingRulePatchPayload,
  type DoctorApiRow,
} from '@/lib/api/clinic-clinical';
import { previewBookingRuleChange } from '@/lib/api/clinic-subscription';
import { conflictsFromApiError, formatScheduleConflicts } from '@/lib/api/conflict-helpers';
import { fetchClinicSettings, patchClinicSettings } from '@/lib/api/clinic-settings';

type DoctorScopedBookingRules = {
  ruleIds: string[];
  ruleId: string;
  doctorName: string;
  slotDurationMinutes: number;
  capacityPerSlot: number;
  bookingHorizonDays: number;
  manualEditCutoffBeforeStartMinutes: number;
  manualEditMaxShiftMinutes: number;
  effectiveFrom: string | null;
  allowDoctorServiceEdit: boolean;
};

type ConflictModalState = {
  implementFrom: string;
  conflicts: string[];
  patch: BookingRulePatchPayload;
};

function toScopedRules(
  row: BookingRuleApiRow,
  ruleIds: string[],
  doctorName: string,
  allowDoctorServiceEdit: boolean,
): DoctorScopedBookingRules {
  return {
    ruleIds,
    ruleId: row.id,
    doctorName,
    slotDurationMinutes: row.slot_duration_minutes,
    capacityPerSlot: row.capacity_per_slot,
    bookingHorizonDays: row.booking_horizon_days,
    manualEditCutoffBeforeStartMinutes: row.manual_edit_cutoff_before_start_minutes,
    manualEditMaxShiftMinutes: row.manual_edit_max_shift_minutes,
    effectiveFrom: row.effective_from ?? null,
    allowDoctorServiceEdit,
  };
}

function normalizeClinicLocalTimestamp(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes('T')) {
    const [datePart = '', timePart = '00:00:00'] = trimmed.split('T');
    return `${datePart} ${timePart.length === 5 ? `${timePart}:00` : timePart.slice(0, 8)}`;
  }
  const [datePart = '', timePart = '00:00:00'] = trimmed.split(' ');
  return `${datePart} ${timePart.length === 5 ? `${timePart}:00` : timePart.slice(0, 8)}`;
}

function formatImplementFromLabel(value: string): string {
  const normalized = normalizeClinicLocalTimestamp(value);
  const [datePart, timePart = '00:00:00'] = normalized.split(' ');
  const timestamp = `${datePart}T${timePart.slice(0, 8)}`;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return normalized.slice(0, 16);
  }
  return `${date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} ${timePart.slice(0, 5)}`;
}

function buildRulePatch(
  current: DoctorScopedBookingRules,
  next: DoctorScopedBookingRules,
): BookingRulePatchPayload {
  const patch: BookingRulePatchPayload = {};

  if (next.slotDurationMinutes !== current.slotDurationMinutes) {
    patch.slot_duration_minutes = next.slotDurationMinutes;
  }
  if (next.capacityPerSlot !== current.capacityPerSlot) {
    patch.capacity_per_slot = next.capacityPerSlot;
  }
  if (next.bookingHorizonDays !== current.bookingHorizonDays) {
    patch.booking_horizon_days = next.bookingHorizonDays;
  }
  if (
    next.manualEditCutoffBeforeStartMinutes !== current.manualEditCutoffBeforeStartMinutes
  ) {
    patch.manual_edit_cutoff_before_start_minutes = next.manualEditCutoffBeforeStartMinutes;
  }
  if (next.manualEditMaxShiftMinutes !== current.manualEditMaxShiftMinutes) {
    patch.manual_edit_max_shift_minutes = next.manualEditMaxShiftMinutes;
  }

  return patch;
}

function latestClinicLocalTimestamp(values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) =>
    normalizeClinicLocalTimestamp(a).localeCompare(normalizeClinicLocalTimestamp(b)),
  );
  return sorted[sorted.length - 1] ?? null;
}

export function BookingRules() {
  const { effectiveRole, me } = useAuth();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [doctorRows, setDoctorRows] = useState<DoctorApiRow[]>([]);
  const [ruleRows, setRuleRows] = useState<BookingRuleApiRow[]>([]);
  const [allowDoctorServiceEdit, setAllowDoctorServiceEdit] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [rules, setRules] = useState<DoctorScopedBookingRules | null>(null);
  const [tempRules, setTempRules] = useState<DoctorScopedBookingRules | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [conflictModal, setConflictModal] = useState<ConflictModalState | null>(null);
  const [applyingImplementFrom, setApplyingImplementFrom] = useState(false);

  const myDoctorId = useMemo(
    () =>
      me?.clinics.find((clinic) => clinic.role === 'doctor')?.doctor_id ??
      me?.clinics[0]?.doctor_id ??
      null,
    [me],
  );

  const doctorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const doctor of doctorRows) {
      map.set(doctor.id, doctor.name);
    }
    return map;
  }, [doctorRows]);

  const rulesByDoctor = useMemo(() => {
    const map = new Map<string, BookingRuleApiRow[]>();

    for (const row of ruleRows) {
      if (!row.active) {
        continue;
      }

      const existing = map.get(row.doctor_id) ?? [];
      existing.push(row);
      map.set(row.doctor_id, existing);
    }

    for (const [doctorId, rows] of map.entries()) {
      rows.sort((a, b) => (b.version ?? 1) - (a.version ?? 1));
      map.set(doctorId, rows);
    }

    return map;
  }, [ruleRows]);

  const availableDoctors = useMemo(
    () =>
      doctorRows
        .filter((doctor) => doctor.active)
        .filter((doctor) => (rulesByDoctor.get(doctor.id)?.length ?? 0) > 0),
    [doctorRows, rulesByDoctor],
  );

  const loadRules = useCallback(async () => {
    if (!clinicId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [bookingRules, settings, doctors] = await Promise.all([
        fetchBookingRules(clinicId),
        fetchClinicSettings(clinicId),
        fetchDoctors(clinicId),
      ]);

      setRuleRows(bookingRules);
      setAllowDoctorServiceEdit(settings.allow_doctor_service_edit);
      setDoctorRows(doctors);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.apiError.message : 'Failed to load booking rules.',
      );
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  useEffect(() => {
    if (availableDoctors.length === 0) {
      setSelectedDoctorId('');
      setRules(null);
      setTempRules(null);
      return;
    }

    const availableDoctorIds = new Set(availableDoctors.map((doctor) => doctor.id));
    const preferredDoctorId = isAdmin
      ? availableDoctorIds.has(selectedDoctorId)
        ? selectedDoctorId
        : (availableDoctors[0]?.id ?? '')
      : myDoctorId && availableDoctorIds.has(myDoctorId)
        ? myDoctorId
        : (availableDoctors[0]?.id ?? '');

    if (preferredDoctorId !== selectedDoctorId) {
      setSelectedDoctorId(preferredDoctorId);
      return;
    }

    const rows = rulesByDoctor.get(preferredDoctorId) ?? [];
    if (rows.length === 0) {
      setRules(null);
      setTempRules(null);
      return;
    }

    const row = rows[0];
    if (!row) {
      setRules(null);
      setTempRules(null);
      return;
    }

    const scoped = toScopedRules(
      row,
      rows.map((rule) => rule.id),
      doctorNameById.get(preferredDoctorId) ?? 'Doctor',
      allowDoctorServiceEdit,
    );

    setRules(scoped);
    if (!isEditing) {
      setTempRules(scoped);
    }
  }, [
    availableDoctors,
    selectedDoctorId,
    isAdmin,
    myDoctorId,
    rulesByDoctor,
    doctorNameById,
    allowDoctorServiceEdit,
    isEditing,
  ]);

  const handleEdit = () => {
    if (!rules) {
      return;
    }
    setTempRules(rules);
    setConflicts([]);
    setConflictModal(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setConflicts([]);
    setConflictModal(null);
    setTempRules(rules);
  };

  const applyChanges = async (
    patch: BookingRulePatchPayload,
    implementFrom?: string,
  ) => {
    if (!clinicId || !rules || !tempRules) {
      return;
    }

    if (Object.keys(patch).length > 0) {
      await Promise.all(
        rules.ruleIds.map((ruleId) =>
          patchBookingRule(clinicId, ruleId, {
            ...patch,
            ...(implementFrom ? { implement_from: implementFrom } : {}),
          }),
        ),
      );
    }

    if (tempRules.allowDoctorServiceEdit !== rules.allowDoctorServiceEdit) {
      await patchClinicSettings(clinicId, {
        allow_doctor_service_edit: tempRules.allowDoctorServiceEdit,
      });
    }

    setIsEditing(false);
    setConflicts([]);
    setConflictModal(null);
    await loadRules();
  };

  const handleSave = async () => {
    if (!clinicId || !rules || !tempRules) {
      return;
    }

    const patch = buildRulePatch(rules, tempRules);
    const capacityOrDurationChanged =
      patch.capacity_per_slot !== undefined || patch.slot_duration_minutes !== undefined;

    try {
      if (capacityOrDurationChanged) {
        const previews = await Promise.all(
          rules.ruleIds.map((ruleId) =>
            previewBookingRuleChange(clinicId, ruleId, {
              ...(patch.capacity_per_slot !== undefined
                ? { capacity_per_slot: patch.capacity_per_slot }
                : {}),
              ...(patch.slot_duration_minutes !== undefined
                ? { slot_duration_minutes: patch.slot_duration_minutes }
                : {}),
            }),
          ),
        );

        const hasBlocked = previews.some((preview) => preview.blocked);
        if (hasBlocked) {
          const aggregatedConflicts = previews.flatMap((preview) => preview.conflicts);
          const formattedConflicts = formatScheduleConflicts(aggregatedConflicts);
          const implementFrom = latestClinicLocalTimestamp(
            previews
              .map((preview) => preview.next_safe_implement_from)
              .filter((value): value is string => Boolean(value)),
          );

          if (implementFrom) {
            setConflictModal({
              implementFrom,
              conflicts: formattedConflicts,
              patch,
            });
            return;
          }

          setConflicts(formattedConflicts);
          return;
        }
      }

      await applyChanges(patch);
    } catch (err) {
      const apiConflicts = conflictsFromApiError(err);
      if (apiConflicts) {
        setConflicts(apiConflicts);
        return;
      }

      setError(err instanceof Error ? err.message : 'Failed to save booking rules.');
    }
  };

  const handleImplementFrom = async () => {
    if (!conflictModal || !tempRules) {
      return;
    }

    setApplyingImplementFrom(true);
    try {
      await applyChanges(conflictModal.patch, conflictModal.implementFrom);
    } catch (err) {
      const apiConflicts = conflictsFromApiError(err);
      if (apiConflicts) {
        setConflicts(apiConflicts);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to apply deferred booking rule.');
      }
      setConflictModal(null);
    } finally {
      setApplyingImplementFrom(false);
    }
  };

  const handleConflictModalCancel = () => {
    setConflictModal(null);
    setIsEditing(false);
    setConflicts([]);
    setTempRules(rules);
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <LoadingState title="Loading booking rules" description="Fetching from the API." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <ErrorState title="Could not load booking rules" description={error}>
          <button
            type="button"
            onClick={() => void loadRules()}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white"
          >
            Retry
          </button>
        </ErrorState>
      </div>
    );
  }

  if (!rules || !tempRules) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-lg font-bold text-slate-900">Booking rules</h3>
        <p className="text-sm text-slate-500">No active doctor-specific booking rule found.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Booking rules</h3>
          {isAdmin && !isEditing && (
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
              onChange={(event) => {
                setSelectedDoctorId(event.target.value);
                setConflicts([]);
                setConflictModal(null);
              }}
              disabled={isEditing}
              className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12 disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              {availableDoctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {!isEditing ? (
          <div className="space-y-3">
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span className="text-sm font-semibold text-slate-600">Doctor</span>
              <span className="text-sm font-bold text-slate-900">{rules.doctorName}</span>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span className="text-sm font-semibold text-slate-600">Slot duration</span>
              <span className="text-sm font-bold text-slate-900">{rules.slotDurationMinutes} minutes</span>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span className="text-sm font-semibold text-slate-600">Capacity per slot</span>
              <span className="text-sm font-bold text-slate-900">{rules.capacityPerSlot} patient(s)</span>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span className="text-sm font-semibold text-slate-600">Booking horizon</span>
              <span className="text-sm font-bold text-slate-900">{rules.bookingHorizonDays} days</span>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span className="text-sm font-semibold text-slate-600">Edit cutoff</span>
              <span className="text-sm font-bold text-slate-900">
                {rules.manualEditCutoffBeforeStartMinutes} minutes before start
              </span>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span className="text-sm font-semibold text-slate-600">Max edit shift</span>
              <span className="text-sm font-bold text-slate-900">{rules.manualEditMaxShiftMinutes} minutes</span>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span className="text-sm font-semibold text-slate-600">Effective from</span>
              <span className="text-sm font-bold text-slate-900">{rules.effectiveFrom ?? 'Today'}</span>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span className="text-sm font-semibold text-slate-600">Doctor service edit</span>
              <span
                className={`text-sm font-bold ${rules.allowDoctorServiceEdit ? 'text-green-600' : 'text-slate-500'}`}
              >
                {rules.allowDoctorServiceEdit ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {conflicts.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <h4 className="mb-2 text-sm font-bold text-red-800">Conflicts detected</h4>
                <ul className="space-y-1 text-sm text-red-700">
                  {conflicts.map((conflict, idx) => (
                    <li key={idx}>- {conflict}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Slot duration (minutes)
                </label>
                <input
                  type="number"
                  min="5"
                  max="120"
                  step="5"
                  value={tempRules.slotDurationMinutes}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    if (Number.isNaN(value)) {
                      return;
                    }
                    setTempRules({ ...tempRules, slotDurationMinutes: value });
                  }}
                  className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Capacity per slot
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={tempRules.capacityPerSlot}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    if (Number.isNaN(value)) {
                      return;
                    }
                    setTempRules({ ...tempRules, capacityPerSlot: value });
                  }}
                  className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Booking horizon (days)
                </label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={tempRules.bookingHorizonDays}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    if (Number.isNaN(value)) {
                      return;
                    }
                    setTempRules({ ...tempRules, bookingHorizonDays: value });
                  }}
                  className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Edit cutoff (minutes before start)
                </label>
                <input
                  type="number"
                  min="0"
                  max="1440"
                  value={tempRules.manualEditCutoffBeforeStartMinutes}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    if (Number.isNaN(value)) {
                      return;
                    }
                    setTempRules({
                      ...tempRules,
                      manualEditCutoffBeforeStartMinutes: value,
                    });
                  }}
                  className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Max edit shift (minutes)
                </label>
                <input
                  type="number"
                  min="0"
                  max="1440"
                  value={tempRules.manualEditMaxShiftMinutes}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    if (Number.isNaN(value)) {
                      return;
                    }
                    setTempRules({
                      ...tempRules,
                      manualEditMaxShiftMinutes: value,
                    });
                  }}
                  className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={tempRules.allowDoctorServiceEdit}
                    onChange={(event) =>
                      setTempRules({
                        ...tempRules,
                        allowDoctorServiceEdit: event.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                  />
                  <span className="text-sm font-semibold text-slate-900">Allow doctor service edit</span>
                </label>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => void handleSave()}
                className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800"
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

      {conflictModal && (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-slate-900/55 p-5"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget && !applyingImplementFrom) {
              handleConflictModalCancel();
            }
          }}
        >
          <div className="w-full max-w-[680px] rounded-[22px] bg-white p-[22px] shadow-2xl">
            <h2 className="mb-2 text-lg font-extrabold text-slate-900">
              Conflicts with existing appointments
            </h2>
            <p className="mb-3 text-sm text-slate-600">
              The new booking rule conflicts with existing appointments. You can implement the
              new rule from{' '}
              <span className="font-bold text-slate-900">
                {formatImplementFromLabel(conflictModal.implementFrom)}
              </span>{' '}
              so current appointments remain unaffected.
            </p>

            {conflictModal.conflicts.length > 0 && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3">
                <ul className="space-y-1 text-sm text-red-700">
                  {conflictModal.conflicts.slice(0, 6).map((conflict, idx) => (
                    <li key={idx}>- {conflict}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => void handleImplementFrom()}
                disabled={applyingImplementFrom}
                className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {applyingImplementFrom
                  ? 'Implementing...'
                  : `Implement from ${formatImplementFromLabel(conflictModal.implementFrom)}`}
              </button>
              <button
                onClick={handleConflictModalCancel}
                disabled={applyingImplementFrom}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
