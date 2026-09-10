'use client';

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
  deleteDoctorService,
  deleteService,
  fetchDoctorServices,
  fetchDoctors,
  fetchServices,
  patchDoctorService,
  patchService,
} from '@/lib/api/clinic-clinical';

type Doctor = {
  id: string;
  name: string;
  specialization: string;
  serviceId: string;
  fee: number;
  active: boolean;
  userId: string | null;
};

type Service = {
  id: string;
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
  const [tempServices, setTempServices] = useState<Service[]>([]);
  const [deletedDoctorIds, setDeletedDoctorIds] = useState<string[]>([]);
  const [deletedServiceIds, setDeletedServiceIds] = useState<string[]>([]);
  const [deletedMappingIds, setDeletedMappingIds] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    if (!isAdmin || !clinicId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [doctorRows, serviceRows, mappingRows] = await Promise.all([
        fetchDoctors(clinicId),
        fetchServices(clinicId),
        fetchDoctorServices(clinicId),
      ]);

      const mappedServices = serviceRows.map((row) => ({
        id: row.id,
        name: row.service_name,
        active: row.active,
      }));

      const mappedMappings = mappingRows.map((row) => ({
        id: row.id,
        doctorId: row.doctor_id,
        serviceId: row.clinic_service_id,
        fee: row.consultation_fee_amount ? parseFloat(row.consultation_fee_amount) : 0,
        active: row.active,
      }));

      const mappedDoctors = doctorRows.map((row) => {
        const mapping = mappedMappings.find((m) => m.doctorId === row.id && m.active)
          ?? mappedMappings.find((m) => m.doctorId === row.id);
        const service = mapping
          ? mappedServices.find((s) => s.id === mapping.serviceId)
          : null;
        return {
          id: row.id,
          name: row.name,
          specialization: row.qualification ?? service?.name ?? '',
          serviceId: mapping?.serviceId ?? '',
          fee: mapping?.fee ?? 0,
          active: row.active,
          userId: row.user_id,
        };
      });

setDoctors(mappedDoctors);
      setServices(mappedServices);
      setDoctorServiceMappings(mappedMappings);
      setTempDoctors(mappedDoctors);
      setTempServices(mappedServices);
      setDeletedDoctorIds([]);
      setDeletedServiceIds([]);
      setDeletedMappingIds([]);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.apiError.message
          : 'Failed to load doctors and services.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAdmin, clinicId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleEdit = () => {
    setTempDoctors(doctors);
    setTempServices(services);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

const handleSave = async () => {
    if (!clinicId) {
      return;
    }

    setError(null);

    try {
      // First, handle deletions
      for (const mappingId of deletedMappingIds) {
        await deleteDoctorService(clinicId, mappingId);
      }

      for (const doctorId of deletedDoctorIds) {
        await deleteDoctor(clinicId, doctorId);
      }

      for (const serviceId of deletedServiceIds) {
        await deleteService(clinicId, serviceId);
      }

      const serviceIdMap = new Map<string, string>();

      for (const service of tempServices) {
        const serviceName = service.name.trim();
        if (!serviceName) {
          if (service.id.startsWith('new-')) {
            continue;
          }
          throw new Error('Service name cannot be empty.');
        }

        if (service.id.startsWith('new-')) {
          const created = await createService(clinicId, {
            service_name: serviceName,
            active: service.active,
          });
          serviceIdMap.set(service.id, created.id);
          continue;
        }

        serviceIdMap.set(service.id, service.id);
        const original = services.find((entry) => entry.id === service.id);
        if (!original) {
          continue;
        }
        if (original.name !== serviceName || original.active !== service.active) {
          await patchService(clinicId, service.id, {
            service_name: serviceName,
            active: service.active,
          });
        }
      }

      for (const doctor of tempDoctors) {
        const doctorName = doctor.name.trim();
        if (!doctorName) {
          if (doctor.id.startsWith('new-')) {
            continue;
          }
          throw new Error('Doctor name cannot be empty.');
        }

        const resolvedServiceId = serviceIdMap.get(doctor.serviceId) ?? doctor.serviceId;
        if (!resolvedServiceId) {
          throw new Error(`Select a service for ${doctorName}.`);
        }

        const consultationFeeAmount = Number.isFinite(doctor.fee) ? doctor.fee : 0;

        if (doctor.id.startsWith('new-')) {
          const createdDoctor = await createDoctor(clinicId, {
            name: doctorName,
            ...(doctor.specialization.trim()
              ? { qualification: doctor.specialization.trim() }
              : {}),
          });

          await createDoctorService(clinicId, {
            doctor_id: createdDoctor.id,
            clinic_service_id: resolvedServiceId,
            consultation_fee_amount: consultationFeeAmount,
            active: true,
          });
          continue;
        }

        const originalDoctor = doctors.find((entry) => entry.id === doctor.id);
        if (!originalDoctor) {
          continue;
        }

        const originalMapping = doctorServiceMappings.find(
          (mapping) => mapping.doctorId === doctor.id,
        );
        const serviceChanged = originalDoctor.serviceId !== resolvedServiceId;

        if (serviceChanged) {
          const sameServiceMapping =
            originalMapping && originalMapping.serviceId === resolvedServiceId
              ? originalMapping
              : null;

          if (sameServiceMapping) {
            await patchDoctorService(clinicId, sameServiceMapping.id, {
              consultation_fee_amount: consultationFeeAmount,
              active: true,
            });
          } else {
            await createDoctorService(clinicId, {
              doctor_id: doctor.id,
              clinic_service_id: resolvedServiceId,
              consultation_fee_amount: consultationFeeAmount,
              active: true,
            });

            if (originalMapping) {
              await patchDoctorService(clinicId, originalMapping.id, { active: false });
            }
          }
          continue;
        }

        const originalActiveMapping = doctorServiceMappings.find(
          (mapping) => mapping.doctorId === doctor.id && mapping.active,
        );
        const feeChanged = originalDoctor.fee !== consultationFeeAmount;
        if ((feeChanged || !originalActiveMapping) && originalMapping) {
          await patchDoctorService(clinicId, originalMapping.id, {
            consultation_fee_amount: consultationFeeAmount,
            active: true,
          });
        }
      }

      setIsEditing(false);
      await loadData();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.apiError.message
          : err instanceof Error
            ? err.message
            : 'Failed to save doctors and services.',
      );
    }
  };

  const addDoctor = () => {
    const firstServiceId = tempServices[0]?.id ?? '';
    const newDoctor: Doctor = {
      id: `new-${Date.now()}`,
      name: '',
      specialization: '',
      serviceId: firstServiceId,
      fee: 0,
      active: true,
      userId: null,
    };
    setTempDoctors([...tempDoctors, newDoctor]);
  };

const removeDoctor = (id: string) => {
    setTempDoctors(tempDoctors.filter((d) => d.id !== id));
    if (!id.startsWith('new-')) {
      setDeletedDoctorIds([...deletedDoctorIds, id]);
      // Also find and mark associated mappings for deletion
      const mappings = doctorServiceMappings.filter((m) => m.doctorId === id && m.active);
      mappings.forEach((m) => setDeletedMappingIds((prev) => [...prev, m.id]));
    }
  };

  const updateDoctor = (id: string, field: keyof Doctor, value: string | number) => {
    setTempDoctors(tempDoctors.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  };

  const addService = () => {
    const newService: Service = {
      id: `new-${Date.now()}`,
      name: '',
      active: true,
    };
    setTempServices([...tempServices, newService]);
  };

  const removeService = (id: string) => {
    setTempServices(tempServices.filter((s) => s.id !== id));
    if (!id.startsWith('new-')) {
      setDeletedServiceIds([...deletedServiceIds, id]);
    }
  };

  const updateService = (id: string, field: keyof Service, value: string) => {
    setTempServices(tempServices.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const toggleDoctorActive = async (id: string) => {
    if (!clinicId) {
      return;
    }
    const doctorMappings = doctorServiceMappings.filter((m) => m.doctorId === id);
    const nextActive = !doctors.find((d) => d.id === id)?.active;
    await Promise.all(
      doctorMappings.map((mapping) =>
        patchDoctorService(clinicId, mapping.id, { active: nextActive }),
      ),
    );
    await loadData();
  };

  const toggleServiceActive = async (id: string) => {
    if (!clinicId) {
      return;
    }
    const service = services.find((s) => s.id === id);
    if (!service) {
      return;
    }
    await patchService(clinicId, id, { active: !service.active });
    await loadData();
  };

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Doctors and services</h3>
        </div>
        <p className="text-sm text-slate-500">Only admins can manage doctors and services.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <LoadingState title="Loading doctors and services" description="Fetching from the API." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-900">Doctors and services</h3>
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
        <div className="space-y-4">
          <div>
            <h4 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">
              Doctors
            </h4>
            <div className="space-y-2">
              {doctors.map((doctor) => (
                <div
                  key={doctor.id}
                  className={`flex items-center justify-between rounded-lg border p-3 ${doctor.active ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50'}`}
                >
                  <div>
                    <p className="font-bold text-slate-900">{doctor.name}</p>
                    <p className="text-sm text-slate-500">{doctor.specialization || 'No qualification'}</p>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Service: {services.find((service) => service.id === doctor.serviceId)?.name ?? 'Unassigned'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-900">Rs.{doctor.fee}</span>
                    <button
                      onClick={() => void toggleDoctorActive(doctor.id)}
                      className={`rounded-lg px-2 py-1 text-xs font-bold ${doctor.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                    >
                      {doctor.active ? 'Active' : 'Disabled'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">
              Services
            </h4>
            <div className="space-y-2">
              {services.map((service) => (
                <div
                  key={service.id}
                  className={`flex items-center justify-between rounded-lg border p-3 ${service.active ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50'}`}
                >
                  <p className="font-bold text-slate-900">{service.name}</p>
                  <button
                    onClick={() => void toggleServiceActive(service.id)}
                    className={`rounded-lg px-2 py-1 text-xs font-bold ${service.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                  >
                    {service.active ? 'Active' : 'Disabled'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500">Doctors</h4>
              <button
                onClick={addDoctor}
                disabled={tempServices.length === 0}
                className="rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-bold text-green-700 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                + Add doctor
              </button>
            </div>
            {tempServices.length === 0 && (
              <p className="mb-3 text-xs font-semibold text-amber-700">
                Add at least one service before adding a doctor.
              </p>
            )}
            <div className="space-y-3">
              {tempDoctors.map((doctor) => (
                <div key={doctor.id} className="grid gap-2 sm:grid-cols-[1.2fr_1fr_1fr_100px_40px]">
                  <input
                    type="text"
                    value={doctor.name}
                    onChange={(e) => updateDoctor(doctor.id, 'name', e.target.value)}
                    placeholder="Doctor name"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                  />
                  <input
                    type="text"
                    value={doctor.specialization}
                    onChange={(e) => updateDoctor(doctor.id, 'specialization', e.target.value)}
                    placeholder="Qualification"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                  />
                  <select
                    value={doctor.serviceId}
                    onChange={(e) => updateDoctor(doctor.id, 'serviceId', e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                    required
                  >
                    <option value="">Select service</option>
                    {tempServices.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name || 'Untitled service'}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={doctor.fee}
                    onChange={(e) => updateDoctor(doctor.id, 'fee', Number(e.target.value) || 0)}
                    placeholder="Fee"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                    min={0}
                  />
                  <button
                    onClick={() => removeDoctor(doctor.id)}
                    className="rounded-lg border border-red-200 bg-red-50 px-2 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {tempDoctors.some((doctor) => !doctor.serviceId) && (
              <p className="mt-2 text-xs font-semibold text-amber-700">
                Each doctor must have a selected service.
              </p>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500">Services</h4>
              <button
                onClick={addService}
                className="rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-bold text-green-700 hover:bg-green-100"
              >
                + Add service
              </button>
            </div>
            <div className="space-y-3">
              {tempServices.map((service) => (
                <div key={service.id} className="flex gap-2">
                  <input
                    type="text"
                    value={service.name}
                    onChange={(e) => updateService(service.id, 'name', e.target.value)}
                    placeholder="Service name"
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                  />
                  <button
                    onClick={() => removeService(service.id)}
                    className="rounded-lg border border-red-200 bg-red-50 px-2 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                  >
                    ✕
                  </button>
                </div>
              ))}
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
  );
}
