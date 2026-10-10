'use client';

import { PREDEFINED_CLINIC_SERVICES, findPredefinedClinicService } from '@vaidya/shared';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import {
  createDoctor,
  createDoctorService,
  createService,
  deleteDoctor,
  fetchDoctorServices,
  fetchDoctors,
  fetchServices,
  patchDoctorService,
  patchService,
} from '@/lib/api/clinic-clinical';
import { isAbortError, useAbortableLoad } from './useAbortableLoad';

type Doctor = {
  id: string;
  name: string;
  specialization: string;
  serviceId: string;
  serviceKey: string;
  serviceName: string;
  fee: number;
  active: boolean;
  userId: string | null;
};

type Service = {
  id: string;
  key: string;
  name: string;
  active: boolean;
};

type DoctorServiceMapping = {
  id: string;
  doctorId: string;
  serviceId: string;
  fee: number;
  active: boolean;
};

function displayServiceName(serviceKey: string, fallback: string): string {
  return findPredefinedClinicService(serviceKey)?.service_name ?? (fallback || 'Unassigned');
}

export function DoctorManagement() {
  const { effectiveRole } = useAuth();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [doctorServiceMappings, setDoctorServiceMappings] = useState<DoctorServiceMapping[]>([]);
  const [tempDoctors, setTempDoctors] = useState<Doctor[]>([]);
  const [deletedDoctorIds, setDeletedDoctorIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const { beginLoad, cancelLoad, isActive } = useAbortableLoad(JSON.stringify([clinicId, isAdmin]));

  const loadData = useCallback(
    async (showLoading = true) => {
      const request = beginLoad();
      if (!request) {
        return;
      }

      if (!isAdmin || !clinicId) {
        if (request.isCurrent()) {
          setDoctors([]);
          setServices([]);
          setDoctorServiceMappings([]);
          setTempDoctors([]);
          setLoading(false);
        }
        return;
      }

      if (showLoading) {
        setLoading(true);
      }
      setError(null);

      try {
        const [doctorRows, serviceRows, mappingRows] = await Promise.all([
          fetchDoctors(clinicId, request.signal),
          fetchServices(clinicId, request.signal),
          fetchDoctorServices(clinicId, request.signal),
        ]);
        if (!request.isCurrent()) {
          return;
        }

        const mappedServices = serviceRows.map((row) => ({
          id: row.id,
          key: row.service_key,
          name: row.service_name,
          active: row.active,
        }));

        const mappedMappings = mappingRows.map((row) => ({
          id: row.id,
          doctorId: row.doctor_id,
          serviceId: row.clinic_service_id,
          fee: row.consultation_fee_amount ? Number.parseFloat(row.consultation_fee_amount) : 0,
          active: row.active,
        }));

        const mappedDoctors = doctorRows.map((row) => {
          const mapping =
            mappedMappings.find((entry) => entry.doctorId === row.id && entry.active) ??
            mappedMappings.find((entry) => entry.doctorId === row.id);
          const service = mapping
            ? mappedServices.find((entry) => entry.id === mapping.serviceId)
            : undefined;

          return {
            id: row.id,
            name: row.name,
            specialization: row.qualification ?? '',
            serviceId: mapping?.serviceId ?? '',
            serviceKey: service?.key ?? '',
            serviceName: service?.name ?? '',
            fee: mapping?.fee ?? 0,
            active: row.active && (mapping?.active ?? true),
            userId: row.user_id,
          };
        });

        setDoctors(mappedDoctors);
        setServices(mappedServices);
        setDoctorServiceMappings(mappedMappings);
        setTempDoctors(mappedDoctors);
        setDeletedDoctorIds([]);
      } catch (err) {
        if (!request.isCurrent() || isAbortError(err)) {
          return;
        }
        setError(
          err instanceof ApiRequestError
            ? err.apiError.message
            : 'Failed to load doctors and services.',
        );
      } finally {
        if (showLoading && request.isCurrent()) {
          setLoading(false);
        }
      }
    },
    [beginLoad, clinicId, isAdmin],
  );

  useEffect(() => {
    setIsEditing(false);
    setDeletedDoctorIds([]);
    setError(null);
    setSaving(false);
    void loadData();
    return cancelLoad;
  }, [cancelLoad, loadData]);

  const handleEdit = () => {
    setTempDoctors(doctors.map((doctor) => ({ ...doctor })));
    setDeletedDoctorIds([]);
    setError(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setTempDoctors(doctors.map((doctor) => ({ ...doctor })));
    setDeletedDoctorIds([]);
    setError(null);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!clinicId || !isActive()) {
      return;
    }

    setError(null);
    setSaving(true);

    try {
      const doctorsToSave = tempDoctors.filter(
        (doctor) => !doctor.id.startsWith('new-') || doctor.name.trim().length > 0,
      );

      for (const doctor of doctorsToSave) {
        const doctorName = doctor.name.trim();
        if (!doctorName) {
          throw new Error('Doctor name cannot be empty.');
        }
        if (!doctor.serviceKey) {
          throw new Error(`Select a service for ${doctorName}.`);
        }
        if (
          !findPredefinedClinicService(doctor.serviceKey) &&
          !services.some((service) => service.key === doctor.serviceKey)
        ) {
          throw new Error(`Select a predefined service for ${doctorName}.`);
        }
      }

      for (const doctorId of deletedDoctorIds) {
        if (!isActive()) {
          return;
        }
        await deleteDoctor(clinicId, doctorId);
        if (!isActive()) {
          return;
        }
      }

      const serviceIdByKey = new Map(services.map((service) => [service.key, service.id]));
      const selectedServiceKeys = [...new Set(doctorsToSave.map((doctor) => doctor.serviceKey))];
      const activeServiceKeys = new Set(
        doctorsToSave.filter((doctor) => doctor.active).map((doctor) => doctor.serviceKey),
      );

      for (const serviceKey of selectedServiceKeys) {
        const predefinedService = findPredefinedClinicService(serviceKey);
        const existingService = services.find((service) => service.key === serviceKey);
        const shouldBeActive = activeServiceKeys.has(serviceKey);

        if (!predefinedService) {
          if (!existingService) {
            throw new Error('Select one of the predefined services.');
          }
          serviceIdByKey.set(serviceKey, existingService.id);
          if (existingService.active !== shouldBeActive) {
            if (!isActive()) {
              return;
            }
            await patchService(clinicId, existingService.id, { active: shouldBeActive });
            if (!isActive()) {
              return;
            }
          }
          continue;
        }

        if (existingService) {
          serviceIdByKey.set(serviceKey, existingService.id);
          if (
            existingService.name !== predefinedService.service_name ||
            existingService.active !== shouldBeActive
          ) {
            if (!isActive()) {
              return;
            }
            await patchService(clinicId, existingService.id, {
              service_name: predefinedService.service_name,
              active: shouldBeActive,
            });
            if (!isActive()) {
              return;
            }
          }
          continue;
        }

        if (!isActive()) {
          return;
        }
        const createdService = await createService(clinicId, {
          service_key: predefinedService.service_key,
          service_name: predefinedService.service_name,
          active: shouldBeActive,
        });
        if (!isActive()) {
          return;
        }
        serviceIdByKey.set(serviceKey, createdService.id);
      }

      for (const doctor of doctorsToSave) {
        const doctorName = doctor.name.trim();
        const resolvedServiceId = serviceIdByKey.get(doctor.serviceKey);
        if (!resolvedServiceId) {
          throw new Error(`Could not save the selected service for ${doctorName}.`);
        }

        const consultationFeeAmount = Number.isFinite(doctor.fee) ? doctor.fee : 0;

        if (doctor.id.startsWith('new-')) {
          if (!isActive()) {
            return;
          }
          const createdDoctor = await createDoctor(clinicId, {
            name: doctorName,
            ...(doctor.specialization.trim()
              ? { qualification: doctor.specialization.trim() }
              : {}),
          });
          if (!isActive()) {
            return;
          }

          await createDoctorService(clinicId, {
            doctor_id: createdDoctor.id,
            clinic_service_id: resolvedServiceId,
            consultation_fee_amount: consultationFeeAmount,
            active: doctor.active,
          });
          if (!isActive()) {
            return;
          }
          continue;
        }

        const doctorMappings = doctorServiceMappings.filter(
          (mapping) => mapping.doctorId === doctor.id,
        );
        const targetMapping = doctorMappings.find(
          (mapping) => mapping.serviceId === resolvedServiceId,
        );

        if (targetMapping) {
          if (
            targetMapping.active !== doctor.active ||
            targetMapping.fee !== consultationFeeAmount
          ) {
            if (!isActive()) {
              return;
            }
            await patchDoctorService(clinicId, targetMapping.id, {
              consultation_fee_amount: consultationFeeAmount,
              active: doctor.active,
            });
            if (!isActive()) {
              return;
            }
          }
        } else {
          if (!isActive()) {
            return;
          }
          await createDoctorService(clinicId, {
            doctor_id: doctor.id,
            clinic_service_id: resolvedServiceId,
            consultation_fee_amount: consultationFeeAmount,
            active: doctor.active,
          });
          if (!isActive()) {
            return;
          }
        }

        const mappingsToDisable = doctorMappings.filter(
          (mapping) => mapping.active && mapping.serviceId !== resolvedServiceId,
        );
        for (const mapping of mappingsToDisable) {
          if (!isActive()) {
            return;
          }
          await patchDoctorService(clinicId, mapping.id, { active: false });
          if (!isActive()) {
            return;
          }
        }
      }

      const selectedServiceKeySet = new Set(selectedServiceKeys);
      for (const service of services) {
        if (!selectedServiceKeySet.has(service.key) && service.active) {
          if (!isActive()) {
            return;
          }
          await patchService(clinicId, service.id, { active: false });
          if (!isActive()) {
            return;
          }
        }
      }

      if (!isActive()) {
        return;
      }
      setIsEditing(false);
      await loadData(false);
    } catch (err) {
      if (!isActive()) {
        return;
      }
      setError(
        err instanceof ApiRequestError
          ? err.apiError.message
          : err instanceof Error
            ? err.message
            : 'Failed to save doctors and services.',
      );
    } finally {
      if (isActive()) {
        setSaving(false);
      }
    }
  };

  const addDoctor = () => {
    setTempDoctors((current) => [
      ...current,
      {
        id: `new-${Date.now()}-${current.length}`,
        name: '',
        specialization: '',
        serviceId: '',
        serviceKey: '',
        serviceName: '',
        fee: 0,
        active: true,
        userId: null,
      },
    ]);
  };

  const removeDoctor = (id: string) => {
    setTempDoctors((current) => current.filter((doctor) => doctor.id !== id));
    if (!id.startsWith('new-')) {
      setDeletedDoctorIds((current) => [...current, id]);
    }
  };

  const updateDoctor = (id: string, field: keyof Doctor, value: string | number) => {
    setTempDoctors((current) =>
      current.map((doctor) => (doctor.id === id ? { ...doctor, [field]: value } : doctor)),
    );
  };

  const toggleDoctorActive = async (id: string) => {
    if (!clinicId || !isActive()) {
      return;
    }

    const doctor = doctors.find((entry) => entry.id === id);
    const currentMapping = doctorServiceMappings.find(
      (mapping) => mapping.doctorId === id && mapping.serviceId === doctor?.serviceId,
    );
    if (!doctor || !currentMapping) {
      return;
    }

    const nextActive = !doctor.active;
    await patchDoctorService(clinicId, currentMapping.id, { active: nextActive });
    if (!isActive()) {
      return;
    }

    const service = services.find((entry) => entry.id === currentMapping.serviceId);
    const hasOtherActiveDoctor = doctorServiceMappings.some(
      (mapping) =>
        mapping.doctorId !== id && mapping.serviceId === currentMapping.serviceId && mapping.active,
    );
    const shouldBeActive = nextActive || hasOtherActiveDoctor;
    if (service && service.active !== shouldBeActive) {
      await patchService(clinicId, service.id, { active: shouldBeActive });
      if (!isActive()) {
        return;
      }
    }
    if (!isActive()) {
      return;
    }
    await loadData();
  };

  if (!isAdmin) {
    return (
      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">Doctors and services</h3>
        </div>
        <p className="text-sm text-slate-500">Only admins can manage doctors and services.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <LoadingState title="Loading doctors and services" description="Fetching from the API." />
      </div>
    );
  }

  if (error && !isEditing) {
    return (
      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <ErrorState title="Could not load doctors and services" description={error}>
          <button
            type="button"
            onClick={() => void loadData()}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white"
          >
            Retry
          </button>
        </ErrorState>
      </div>
    );
  }

  return (
    <div
      data-testid="doctor-management-card"
      className={`doctor-management-card min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${isEditing ? 'xl:col-span-2' : ''}`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-900">Doctors and services</h3>
        {!isEditing && (
          <button
            type="button"
            onClick={handleEdit}
            className="rounded-xl border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100"
          >
            Edit
          </button>
        )}
      </div>

      {!isEditing ? (
        <div>
          <h4 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">
            Doctors
          </h4>
          {doctors.length === 0 ? (
            <p className="text-sm text-slate-500">No doctors configured.</p>
          ) : (
            <div className="space-y-2">
              {doctors.map((doctor) => (
                <div
                  key={doctor.id}
                  className={`doctor-summary-row flex min-w-0 flex-col gap-3 rounded-lg border p-3 ${
                    doctor.active ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-bold text-slate-900">{doctor.name}</p>
                    <p className="break-words text-sm text-slate-500">
                      {doctor.specialization || 'No qualification'}
                    </p>
                    <p className="break-words text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Service: {displayServiceName(doctor.serviceKey, doctor.serviceName)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <span className="text-sm font-bold text-slate-900">Rs.{doctor.fee}</span>
                    <button
                      type="button"
                      onClick={() => void toggleDoctorActive(doctor.id)}
                      className={`rounded-lg px-2 py-1 text-xs font-bold ${
                        doctor.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {doctor.active ? 'Active' : 'Disabled'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700"
            >
              {error}
            </div>
          )}

          <div>
            <div className="doctor-editor-header mb-3 flex flex-col gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500">
                  Doctors
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  Select one predefined service for each doctor.
                </p>
              </div>
              <button
                type="button"
                onClick={addDoctor}
                className="doctor-add-button w-full shrink-0 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs font-bold text-green-700 hover:bg-green-100"
              >
                + Add doctor
              </button>
            </div>

            <div className="space-y-3">
              {tempDoctors.map((doctor) => {
                const isLegacyService =
                  doctor.serviceKey.length > 0 && !findPredefinedClinicService(doctor.serviceKey);

                return (
                  <div
                    key={doctor.id}
                    data-testid="doctor-editor-row"
                    className="doctor-editor-row grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                  >
                    <label className="block min-w-0">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Doctor name
                      </span>
                      <input
                        type="text"
                        value={doctor.name}
                        onChange={(event) => updateDoctor(doctor.id, 'name', event.target.value)}
                        placeholder="Doctor name"
                        aria-label="Doctor name"
                        className="mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Qualification
                      </span>
                      <input
                        type="text"
                        value={doctor.specialization}
                        onChange={(event) =>
                          updateDoctor(doctor.id, 'specialization', event.target.value)
                        }
                        placeholder="Qualification"
                        aria-label={`Qualification for ${doctor.name || 'new doctor'}`}
                        className="mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                      />
                    </label>
                    <label className="doctor-service-field block min-w-0">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Service
                      </span>
                      <select
                        value={doctor.serviceKey}
                        onChange={(event) => {
                          const selected = findPredefinedClinicService(event.target.value);
                          updateDoctor(doctor.id, 'serviceKey', event.target.value);
                          if (selected) {
                            updateDoctor(doctor.id, 'serviceName', selected.service_name);
                          }
                        }}
                        aria-label={`Service for ${doctor.name || 'new doctor'}`}
                        className="mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                        required
                      >
                        <option value="">Select service</option>
                        {isLegacyService && (
                          <option value={doctor.serviceKey}>
                            {doctor.serviceName || doctor.serviceKey} (Current custom service)
                          </option>
                        )}
                        {PREDEFINED_CLINIC_SERVICES.map((service) => (
                          <option key={service.service_key} value={service.service_key}>
                            {service.service_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block min-w-0">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Fee (Rs.)
                      </span>
                      <input
                        type="number"
                        value={doctor.fee}
                        onChange={(event) =>
                          updateDoctor(doctor.id, 'fee', Number(event.target.value) || 0)
                        }
                        placeholder="Fee"
                        aria-label={`Fee for ${doctor.name || 'new doctor'}`}
                        className="mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                        min={0}
                      />
                    </label>
                    <div className="flex min-w-0 items-end">
                      <button
                        type="button"
                        onClick={() => removeDoctor(doctor.id)}
                        aria-label={`Remove ${doctor.name || 'new doctor'}`}
                        className="doctor-remove-button w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {tempDoctors.some((doctor) => doctor.name.trim() && !doctor.serviceKey) && (
              <p className="mt-2 text-xs font-semibold text-amber-700">
                Each doctor must have a selected service.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
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
