import { PortalLayout } from '@/components/layout/PortalLayout';
import { CallInboxPageContent } from '@/components/pages/call-inbox/CallInboxPageContent';

export default function CallInboxPage() {
  return (
    <PortalLayout>
      <CallInboxPageContent />
    </PortalLayout>
  );
}
