'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { DoctorManagement } from '@/components/pages/clinic-setup/DoctorManagement';
import { ClinicHours } from '@/components/pages/clinic-setup/ClinicHours';
import { HolidaySetup } from '@/components/pages/clinic-setup/HolidaySetup';
import { DoctorSchedule } from '@/components/pages/clinic-setup/DoctorSchedule';
import { BookingRules } from '@/components/pages/clinic-setup/BookingRules';
import { UserManagement } from '@/components/pages/clinic-setup/UserManagement';

export function ClinicSetupPageContent() {
  const { effectiveRole } = useAuth();
  const isAdmin = effectiveRole === 'admin';

  return (
    <>
      <PageHeader
        title="Clinic setup"
        description={
          effectiveRole === 'doctor'
            ? 'Manage your schedule and services when enabled by clinic policy.'
            : 'Manage your doctors, services, schedules, and team in one place.'
        }
      />

      <div className="portal-card-grid gap-4">
        {isAdmin && (
          <>
            <DoctorManagement />
            <ClinicHours />
            <HolidaySetup />
            <DoctorSchedule />
            <BookingRules />
            <UserManagement />
          </>
        )}

        {effectiveRole === 'doctor' && (
          <>
            <DoctorSchedule />
            <BookingRules />
          </>
        )}
      </div>
    </>
  );
}
