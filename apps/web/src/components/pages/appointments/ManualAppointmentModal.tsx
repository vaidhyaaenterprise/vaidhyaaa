'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import {
  fetchAvailableAppointmentSlots,
  type AppointmentAvailableSlotApiRow,
} from '@/lib/api/appointments';
import {
  fetchHolidays,
  searchPatientHistory,
  type HolidayApiRow,
} from '@/lib/api/clinic-clinical';
import type { BookingRules } from './types';

interface ManualAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookingRules: BookingRules;
  doctors: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
  doctorServiceMappings: Array<{ doctorId: string; serviceId: string }>;
  onCreateAppointment: (data: ManualAppointmentData) => void;
}

export interface ManualAppointmentData {
  patientName: string;
  patientPhone: string;
  patientAge: string;
  patientDateOfBirth: string;
  doctorId: string;
  serviceId: string;
  appointmentDate: string;
  appointmentTime: string;
  reasonForVisit: string;
  visitType: 'new' | 'follow_up';
  overrideReason?: string | undefined;
  slotId?: string | undefined;
  appointmentStart?: string | undefined;
  appointmentEnd?: string | undefined;
}

type SlotOption = {
  slotId: string;
  appointmentStart: string;
  appointmentEnd: string;
  label: string;
  availableCount: number;
};

type CalendarDay = {
  date: Date;
  isoDate: string;
  inCurrentMonth: boolean;
};

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseIsoDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function formatDisplayDate(isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) {
    return isoDate;
  }
  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function buildCalendarDays(visibleMonth: Date): CalendarDay[] {
  const firstDay = startOfMonth(visibleMonth);
  const firstCell = new Date(firstDay);
  firstCell.setDate(firstCell.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    return {
      date,
      isoDate: formatIsoDate(date),
      inCurrentMonth: date.getMonth() === visibleMonth.getMonth(),
    };
  });
}

function extractTime(isoLike: string): string {
  const match = isoLike.match(/(?:T|\s)(\d{2}:\d{2})/);
  return match?.[1] ?? '';
}

function formatSlotLabel(isoLike: string): string {
  const value = extractTime(isoLike);
  const [hoursRaw, minutesRaw] = value.split(':');
  const hours = Number(hoursRaw);
  const minutes = minutesRaw ?? '00';
  if (Number.isNaN(hours)) {
    return isoLike;
  }
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${String(displayHours).padStart(2, '0')}:${minutes} ${suffix}`;
}

function mapSlots(rows: AppointmentAvailableSlotApiRow[]): SlotOption[] {
  return rows.map((row) => ({
    slotId: row.slot_id,
    appointmentStart: row.appointment_start,
    appointmentEnd: row.appointment_end,
    label: formatSlotLabel(row.appointment_start),
    availableCount: row.available_count,
  }));
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizeName(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function phoneMatches(storedPhone: string | null, inputDigits: string): boolean {
  if (!storedPhone) {
    return false;
  }
  const storedDigits = normalizePhone(storedPhone);
  if (!storedDigits || !inputDigits) {
    return false;
  }
  return (
    storedDigits === inputDigits ||
    storedDigits.endsWith(inputDigits) ||
    inputDigits.endsWith(storedDigits)
  );
}

export function ManualAppointmentModal({
  isOpen,
  onClose,
  bookingRules: _bookingRules,
  doctors,
  services,
  doctorServiceMappings,
  onCreateAppointment,
}: ManualAppointmentModalProps) {
  const { effectiveRole, me } = useAuth();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';
  const currentDoctorId = me?.clinics[0]?.doctor_id;

  const [formData, setFormData] = useState<ManualAppointmentData>({
    patientName: '',
    patientPhone: '',
    patientAge: '',
    patientDateOfBirth: '',
    doctorId: currentDoctorId || doctors[0]?.id || '',
    serviceId: services[0]?.id || '',
    appointmentDate: '',
    appointmentTime: '',
    reasonForVisit: '',
    visitType: 'new',
    overrideReason: '',
  });

  const todayIsoDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [holidayRows, setHolidayRows] = useState<HolidayApiRow[]>([]);
  const datePickerRef = useRef<HTMLDivElement | null>(null);

  const [showOverride, setShowOverride] = useState(false);
  const [slotOptions, setSlotOptions] = useState<SlotOption[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [followupIdentityHint, setFollowupIdentityHint] = useState<string | null>(null);
  const [checkingFollowupIdentity, setCheckingFollowupIdentity] = useState(false);

  const serviceOptionsForDoctor = useMemo(() => {
    if (!formData.doctorId) {
      return services;
    }

    const allowedServiceIds = new Set(
      doctorServiceMappings
        .filter((mapping) => mapping.doctorId === formData.doctorId)
        .map((mapping) => mapping.serviceId),
    );

    if (allowedServiceIds.size === 0) {
      return services;
    }

    return services.filter((service) => allowedServiceIds.has(service.id));
  }, [doctorServiceMappings, formData.doctorId, services]);

  useEffect(() => {
    if (!isOpen || !formData.doctorId) {
      return;
    }

    if (serviceOptionsForDoctor.length === 0) {
      return;
    }

    const currentStillValid = serviceOptionsForDoctor.some(
      (service) => service.id === formData.serviceId,
    );
    if (currentStillValid) {
      return;
    }

    const fallbackService = serviceOptionsForDoctor[0];
    if (!fallbackService) {
      return;
    }

    setFormData((previous) => ({
      ...previous,
      serviceId: fallbackService.id,
      slotId: '',
      appointmentTime: '',
      appointmentStart: undefined,
      appointmentEnd: undefined,
    }));
  }, [formData.doctorId, formData.serviceId, isOpen, serviceOptionsForDoctor]);

  const selectedSlot = useMemo(
    () => slotOptions.find((slot) => slot.slotId === formData.slotId),
    [slotOptions, formData.slotId],
  );

  const holidayByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const holiday of holidayRows) {
      if (!holiday.active) {
        continue;
      }
      if (
        !holiday.applies_to_clinic &&
        (!formData.doctorId || !holiday.doctor_ids.includes(formData.doctorId))
      ) {
        continue;
      }
      map.set(holiday.holiday_date, holiday.reason?.trim() || 'Holiday');
    }
    return map;
  }, [formData.doctorId, holidayRows]);

  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);

  useEffect(() => {
    if (!isOpen) {
      setIsDatePickerOpen(false);
      return;
    }
    if (!clinicId) {
      setHolidayRows([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const holidays = await fetchHolidays(clinicId);
        if (!cancelled) {
          setHolidayRows(holidays.filter((row) => row.active));
        }
      } catch {
        if (!cancelled) {
          setHolidayRows([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clinicId, isOpen]);

  useEffect(() => {
    if (!isDatePickerOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (!datePickerRef.current?.contains(event.target)) {
        setIsDatePickerOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDatePickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isDatePickerOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (!clinicId || !formData.doctorId || !formData.serviceId || !formData.appointmentDate) {
      setSlotOptions([]);
      setSlotsError(null);
      return;
    }

    let cancelled = false;

    const loadSlots = async () => {
      setSlotsLoading(true);
      setSlotsError(null);
      try {
        const rows = await fetchAvailableAppointmentSlots(clinicId, {
          doctor_id: formData.doctorId,
          clinic_service_id: formData.serviceId,
          date: formData.appointmentDate,
        });
        if (cancelled) {
          return;
        }
        const mapped = mapSlots(rows);
        setSlotOptions(mapped);
        if (mapped.length > 0) {
          const nextSlot = mapped[0];
          if (!nextSlot) {
            return;
          }
          setFormData((previous) => {
            const stillValid = previous.slotId && mapped.some((slot) => slot.slotId === previous.slotId);
            const chosen = stillValid ? mapped.find((slot) => slot.slotId === previous.slotId) : nextSlot;
            if (!chosen) {
              return previous;
            }
            return {
              ...previous,
              slotId: chosen.slotId,
              appointmentTime: extractTime(chosen.appointmentStart),
              appointmentStart: chosen.appointmentStart,
              appointmentEnd: chosen.appointmentEnd,
            };
          });
        } else {
          setFormData((previous) => ({
            ...previous,
            slotId: '',
            appointmentTime: '',
            appointmentStart: undefined,
            appointmentEnd: undefined,
          }));
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSlotOptions([]);
        setFormData((previous) => ({
          ...previous,
          slotId: '',
          appointmentTime: '',
          appointmentStart: undefined,
          appointmentEnd: undefined,
        }));
        setSlotsError(error instanceof Error ? error.message : 'Failed to load available slots.');
      } finally {
        if (!cancelled) {
          setSlotsLoading(false);
        }
      }
    };

    void loadSlots();

    return () => {
      cancelled = true;
    };
  }, [clinicId, formData.appointmentDate, formData.doctorId, formData.serviceId, isOpen]);

  useEffect(() => {
    if (!isOpen || !clinicId || formData.visitType !== 'follow_up') {
      setFollowupIdentityHint(null);
      setCheckingFollowupIdentity(false);
      return;
    }

    const phoneDigits = normalizePhone(formData.patientPhone);
    const normalizedPatientName = normalizeName(formData.patientName);
    const hasDob = formData.patientDateOfBirth.trim().length > 0;

    if (hasDob || phoneDigits.length < 8 || normalizedPatientName.length < 2) {
      setFollowupIdentityHint(null);
      setCheckingFollowupIdentity(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setCheckingFollowupIdentity(true);
        try {
          const rows = await searchPatientHistory(clinicId, {
            phone: formData.patientPhone.trim(),
            name: formData.patientName.trim(),
          });
          if (cancelled) {
            return;
          }

          const exactMatches = rows.filter((patient) => {
            const sameName = normalizeName(patient.name) === normalizedPatientName;
            const samePhone = phoneMatches(patient.phone, phoneDigits);
            return sameName && samePhone;
          });

          setFollowupIdentityHint(
            exactMatches.length > 1
              ? 'Please enter DOB to identify existing patient exactly.'
              : null,
          );
        } catch {
          if (!cancelled) {
            setFollowupIdentityHint(null);
          }
        } finally {
          if (!cancelled) {
            setCheckingFollowupIdentity(false);
          }
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    clinicId,
    formData.patientDateOfBirth,
    formData.patientName,
    formData.patientPhone,
    formData.visitType,
    isOpen,
  ]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const parsedAge = Number.parseInt(formData.patientAge.trim(), 10);

    if (!formData.patientName || !formData.patientPhone || !formData.reasonForVisit || !formData.patientAge.trim()) {
      alert('Please fill in all required fields');
      return;
    }

    if (Number.isNaN(parsedAge) || parsedAge < 0 || parsedAge > 130) {
      alert('Patient age must be a valid number between 0 and 130.');
      return;
    }

    if (formData.patientDateOfBirth) {
      const dobDate = new Date(formData.patientDateOfBirth);
      if (Number.isNaN(dobDate.getTime())) {
        alert('Patient DOB must be a valid date.');
        return;
      }

      const today = new Date();
      if (dobDate > today) {
        alert('Patient DOB cannot be in the future.');
        return;
      }
    }

    if (!formData.appointmentDate || !formData.appointmentTime) {
      alert('Please select date and time.');
      return;
    }

    if (formData.visitType === 'follow_up' && !formData.patientDateOfBirth && followupIdentityHint) {
      alert(followupIdentityHint);
      return;
    }

    if (!showOverride && !formData.slotId) {
      alert('Please select a slot-backed time from available slots.');
      return;
    }

    onCreateAppointment({
      ...formData,
      patientAge: String(parsedAge),
      ...(formData.patientDateOfBirth ? { patientDateOfBirth: formData.patientDateOfBirth } : {}),
    });
    onClose();
    
    // Reset form
    setFormData({
      patientName: '',
      patientPhone: '',
      patientAge: '',
      patientDateOfBirth: '',
      doctorId: currentDoctorId || doctors[0]?.id || '',
      serviceId: services[0]?.id || '',
      appointmentDate: '',
      appointmentTime: '',
      reasonForVisit: '',
      visitType: 'new',
      overrideReason: '',
      slotId: '',
      appointmentStart: undefined,
      appointmentEnd: undefined,
    });
    setShowOverride(false);
    setSlotOptions([]);
    setSlotsError(null);
    setFollowupIdentityHint(null);
    setCheckingFollowupIdentity(false);
    setIsDatePickerOpen(false);
  };

  const openDatePicker = () => {
    const selectedDate = parseIsoDate(formData.appointmentDate) ?? new Date();
    setCalendarMonth(startOfMonth(selectedDate));
    setIsDatePickerOpen(true);
  };

  const handleDateSelection = (isoDate: string, selectedDate: Date) => {
    setFormData((previous) => ({
      ...previous,
      appointmentDate: isoDate,
      slotId: '',
      appointmentTime: '',
      appointmentStart: undefined,
      appointmentEnd: undefined,
    }));
    setCalendarMonth(startOfMonth(selectedDate));
    setIsDatePickerOpen(false);
  };

  const clearDateSelection = () => {
    setFormData((previous) => ({
      ...previous,
      appointmentDate: '',
      slotId: '',
      appointmentTime: '',
      appointmentStart: undefined,
      appointmentEnd: undefined,
    }));
    setIsDatePickerOpen(false);
  };

  const pickTodayDate = () => {
    const today = new Date();
    handleDateSelection(formatIsoDate(today), today);
  };

  const availableDoctors = isAdmin ? doctors : doctors.filter((doctor) => doctor.id === currentDoctorId);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-6">
          <h3 className="text-xl font-bold text-slate-900">New manual appointment</h3>
          <p className="text-sm text-slate-500">Create an appointment outside the normal booking flow.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
              Patient name *
            </label>
            <input
              type="text"
              value={formData.patientName}
              onChange={(e) => setFormData({ ...formData, patientName: e.target.value })}
              placeholder="Enter patient name"
              className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
              Patient phone *
            </label>
            <input
              type="tel"
              value={formData.patientPhone}
              onChange={(e) => setFormData({ ...formData, patientPhone: e.target.value })}
              placeholder="+91 98765 43210"
              className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Patient age *
              </label>
              <input
                type="number"
                min={0}
                max={130}
                value={formData.patientAge}
                onChange={(e) => setFormData({ ...formData, patientAge: e.target.value })}
                placeholder="e.g. 38"
                className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Patient DOB (optional)
              </label>
              <input
                type="date"
                value={formData.patientDateOfBirth}
                onChange={(e) => setFormData({ ...formData, patientDateOfBirth: e.target.value })}
                className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                max={todayIsoDate}
              />
              {formData.visitType === 'follow_up' && !formData.patientDateOfBirth && checkingFollowupIdentity && (
                <p className="mt-1 text-xs font-semibold text-slate-500">Checking follow-up patient match...</p>
              )}
              {formData.visitType === 'follow_up' && !formData.patientDateOfBirth && followupIdentityHint && (
                <p className="mt-1 text-xs font-semibold text-amber-700">{followupIdentityHint}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Doctor *
              </label>
              <select
                value={formData.doctorId}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    doctorId: e.target.value,
                    slotId: '',
                    appointmentTime: '',
                    appointmentStart: undefined,
                    appointmentEnd: undefined,
                  })
                }
                className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                required
              >
                {availableDoctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>{doctor.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Service *
              </label>
              <select
                value={formData.serviceId}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    serviceId: e.target.value,
                    slotId: '',
                    appointmentTime: '',
                    appointmentStart: undefined,
                    appointmentEnd: undefined,
                  })
                }
                className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                required
              >
                {serviceOptionsForDoctor.map((service) => (
                  <option key={service.id} value={service.id}>{service.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Date *
              </label>
              <div className="relative" ref={datePickerRef}>
                <button
                  type="button"
                  onClick={() => {
                    if (isDatePickerOpen) {
                      setIsDatePickerOpen(false);
                      return;
                    }
                    openDatePicker();
                  }}
                  aria-haspopup="dialog"
                  aria-expanded={isDatePickerOpen}
                  className="flex w-full items-center justify-between rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                >
                  <span>
                    {formData.appointmentDate ? formatDisplayDate(formData.appointmentDate) : 'Select date'}
                  </span>
                  <span className="text-base leading-none text-slate-400">▾</span>
                </button>
                {isDatePickerOpen && (
                  <div className="absolute left-0 z-30 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                    <div className="mb-3 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setCalendarMonth((previous) => addMonths(previous, -1))}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
                        aria-label="Previous month"
                      >
                        ←
                      </button>
                      <p className="text-sm font-bold text-slate-900">{monthLabel(calendarMonth)}</p>
                      <button
                        type="button"
                        onClick={() => setCalendarMonth((previous) => addMonths(previous, 1))}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
                        aria-label="Next month"
                      >
                        →
                      </button>
                    </div>

                    <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      {WEEKDAY_LABELS.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                      {calendarDays.map((day) => {
                        const isSelected = day.isoDate === formData.appointmentDate;
                        const isToday = day.isoDate === todayIsoDate;
                        const isSunday = day.date.getDay() === 0;
                        const holidayReason = holidayByDate.get(day.isoDate);
                        const isHoliday = Boolean(holidayReason);

                        let styleClass = day.inCurrentMonth
                          ? 'text-slate-700 hover:bg-slate-100'
                          : 'text-slate-300 hover:bg-slate-50';

                        if (isSunday && day.inCurrentMonth) {
                          styleClass = 'bg-rose-50 text-rose-700 hover:bg-rose-100';
                        }
                        if (isHoliday) {
                          styleClass = 'bg-amber-100 text-amber-900 hover:bg-amber-200';
                        }
                        if (isSelected) {
                          styleClass = 'bg-teal-700 text-white shadow-sm hover:bg-teal-800';
                        } else if (isToday) {
                          styleClass = `${styleClass} ring-1 ring-teal-300`;
                        }

                        const title = [
                          isHoliday ? holidayReason : null,
                          isSunday ? 'Sunday' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ');

                        return (
                          <button
                            key={day.isoDate}
                            type="button"
                            title={title || undefined}
                            onClick={() => handleDateSelection(day.isoDate, day.date)}
                            className={`flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold transition-colors ${styleClass}`}
                          >
                            {day.date.getDate()}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded-sm bg-amber-100 ring-1 ring-amber-200" />
                        Holiday
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded-sm bg-rose-50 ring-1 ring-rose-200" />
                        Sunday
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
                      <button
                        type="button"
                        onClick={clearDateSelection}
                        className="text-xs font-bold text-slate-500 hover:text-slate-700"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={pickTodayDate}
                        className="text-xs font-bold text-teal-700 hover:text-teal-800"
                      >
                        Today
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Time *
              </label>
              <select
                value={formData.slotId ?? ''}
                onChange={(e) => {
                  const selected = slotOptions.find((slot) => slot.slotId === e.target.value);
                  if (!selected) {
                    setFormData((previous) => ({
                      ...previous,
                      slotId: '',
                      appointmentTime: '',
                      appointmentStart: undefined,
                      appointmentEnd: undefined,
                    }));
                    return;
                  }
                  setFormData((previous) => ({
                    ...previous,
                    slotId: selected.slotId,
                    appointmentTime: extractTime(selected.appointmentStart),
                    appointmentStart: selected.appointmentStart,
                    appointmentEnd: selected.appointmentEnd,
                  }));
                }}
                className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                required={!showOverride}
                disabled={slotsLoading || (!showOverride && slotOptions.length === 0)}
              >
                <option value="">
                  {slotsLoading
                    ? 'Loading slots...'
                    : slotOptions.length === 0
                      ? 'No open slots available'
                      : 'Select time from open slots'}
                </option>
                {slotOptions.map((slot) => (
                  <option key={slot.slotId} value={slot.slotId}>
                    {slot.label} ({slot.availableCount} left)
                  </option>
                ))}
              </select>
              {slotsError && <p className="mt-1 text-xs text-red-600">{slotsError}</p>}
              {!slotsError && selectedSlot && (
                <p className="mt-1 text-xs text-slate-500">
                  Slot ends at {formatSlotLabel(selectedSlot.appointmentEnd)}
                </p>
              )}
              {!showOverride && slotOptions.length === 0 && !slotsLoading && !slotsError && (
                <p className="mt-1 text-xs text-amber-700">
                  No open DB slots for this doctor/service/date. Enable override only if needed.
                </p>
              )}
              {showOverride && (
                <div className="mt-2">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Manual override time *
                  </label>
                  <input
                    type="time"
                    value={formData.appointmentTime}
                    onChange={(e) =>
                      setFormData((previous) => ({
                        ...previous,
                        slotId: '',
                        appointmentTime: e.target.value,
                        appointmentStart: undefined,
                        appointmentEnd: undefined,
                      }))
                    }
                    className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                    required={showOverride}
                  />
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
              Reason for visit *
            </label>
            <textarea
              value={formData.reasonForVisit}
              onChange={(e) => setFormData({ ...formData, reasonForVisit: e.target.value })}
              placeholder="Describe the reason for visit"
              className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
              rows={3}
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
              Visit type
            </label>
            <div className="flex gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="visitType"
                  value="new"
                  checked={formData.visitType === 'new'}
                  onChange={(e) => setFormData({ ...formData, visitType: e.target.value as 'new' | 'follow_up' })}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                />
                <span className="text-sm font-semibold text-slate-900">New patient</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="visitType"
                  value="follow_up"
                  checked={formData.visitType === 'follow_up'}
                  onChange={(e) => setFormData({ ...formData, visitType: e.target.value as 'new' | 'follow_up' })}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                />
                <span className="text-sm font-semibold text-slate-900">Follow-up</span>
              </label>
            </div>
          </div>

          {isAdmin && (
            <div>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={showOverride}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setShowOverride(enabled);
                    if (enabled) {
                      setFormData((previous) => ({
                        ...previous,
                        slotId: '',
                        appointmentTime: '',
                        appointmentStart: undefined,
                        appointmentEnd: undefined,
                      }));
                    } else {
                      const firstSlot = slotOptions[0];
                      if (firstSlot) {
                        setFormData((previous) => ({
                          ...previous,
                          slotId: firstSlot.slotId,
                          appointmentTime: extractTime(firstSlot.appointmentStart),
                          appointmentStart: firstSlot.appointmentStart,
                          appointmentEnd: firstSlot.appointmentEnd,
                        }));
                      }
                    }
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                />
                <span className="text-sm font-semibold text-slate-900">Override clinic hours</span>
              </label>
              
              {showOverride && (
                <div className="mt-2">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Override reason *
                  </label>
                  <input
                    type="text"
                    value={formData.overrideReason}
                    onChange={(e) => setFormData({ ...formData, overrideReason: e.target.value })}
                    placeholder="Explain why this appointment is outside normal hours"
                    className="w-full rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
                    required={showOverride}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button
              type="submit"
              disabled={!showOverride && (!formData.slotId || slotOptions.length === 0)}
              className="flex-1 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Create appointment
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
