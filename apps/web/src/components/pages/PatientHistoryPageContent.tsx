'use client';

import { DoctorPatientHistory } from '@/components/doctor/DoctorPatientHistory';
import { useAuth } from '@/components/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';

export function PatientHistoryPageContent() {
  const { effectiveRole } = useAuth();

  if (effectiveRole !== 'admin') {
    return (
      <>
        <PageHeader title="Patient History" description="Patient records and visit status." />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">Access denied. Patient history is admin-only.</p>
        </div>
      </>
    );
  }

  return <DoctorPatientHistory />;
}
