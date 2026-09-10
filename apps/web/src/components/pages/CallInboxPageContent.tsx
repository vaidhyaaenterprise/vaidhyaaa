'use client';

import { PageHeader } from '@/components/layout/PageHeader';
import { PlaceholderPanel } from '@/components/layout/PlaceholderPanel';
import { EmptyState } from '@/components/ui/StateViews';

export function CallInboxPageContent() {
  return (
    <>
      <PageHeader
        title="Call inbox"
        description="Voice calls handled by Vaidya. Receptionist sees outcome, action, recording, and short summary."
      />
      <PlaceholderPanel
        title="Call inbox"
        description="Call list, recordings, and transcripts will be implemented in P04."
      >
        <EmptyState
          title="No calls to show yet"
          description="This admin-only view will list today's voice calls once the call inbox milestone is delivered."
        />
      </PlaceholderPanel>
    </>
  );
}
