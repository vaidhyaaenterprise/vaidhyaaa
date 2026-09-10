import { PortalLayout } from '@/components/layout/PortalLayout';
import { JobHealthDashboard } from '@/components/pages/platform/JobHealthDashboard';

export default function JobsPage() {
  return (
    <PortalLayout>
      <JobHealthDashboard />
    </PortalLayout>
  );
}
