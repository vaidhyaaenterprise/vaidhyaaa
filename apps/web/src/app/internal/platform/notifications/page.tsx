import { PortalLayout } from '@/components/layout/PortalLayout';
import { NotificationEventsList } from '@/components/pages/platform/NotificationEventsList';

export default function NotificationsPage() {
  return (
    <PortalLayout>
      <NotificationEventsList />
    </PortalLayout>
  );
}
