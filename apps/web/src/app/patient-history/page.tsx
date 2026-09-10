import { PortalLayout } from '@/components/layout/PortalLayout';
import { PatientHistoryPageContent } from '@/components/pages/PatientHistoryPageContent';

export default function PatientHistoryPage() {
  return (
    <PortalLayout>
      <PatientHistoryPageContent />
    </PortalLayout>
  );
}
