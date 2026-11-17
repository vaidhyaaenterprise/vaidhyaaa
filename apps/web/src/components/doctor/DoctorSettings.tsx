'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { BookingRules } from '@/components/pages/clinic-setup/BookingRules';
import { DoctorSchedule } from '@/components/pages/clinic-setup/DoctorSchedule';
import { HolidaySetup } from '@/components/pages/clinic-setup/HolidaySetup';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';

export function DoctorSettings() {
  const { me } = useAuth();
  const clinicId = useActiveClinicId();
  const doctorId = me?.clinics.find(
    (clinic) => clinic.clinic_id === clinicId && clinic.role === 'doctor' && clinic.active,
  )?.doctor_id;

  return (
    <div className="min-w-0 space-y-5">
      <div>
        <h1 className="text-[26px] font-black tracking-tight text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your holidays, working hours, and appointment booking rules.
        </p>
      </div>
      {clinicId && doctorId ? (
        <>
          <HolidaySetup />
          <DoctorSchedule />
          <BookingRules />
        </>
      ) : (
        <p
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"
        >
          Your doctor profile is not linked to this clinic. Contact the clinic administrator.
        </p>
      )}
    </div>
  );
}
