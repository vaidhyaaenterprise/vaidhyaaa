import { createClient, type RealtimeChannel } from '@supabase/supabase-js';

let client: ReturnType<typeof createClient> | null = null;

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return null;
  }

  client ??= createClient(url, key);
  return client;
}

export function subscribeToClinicKnowledge(
  clinicId: string,
  onChange: () => void,
): (() => void) | null {
  const supabase = getClient();
  if (!supabase) {
    return null;
  }

  let channel: RealtimeChannel | null = supabase
    .channel(`clinic-knowledge-${clinicId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'clinic_knowledge_base',
        filter: `clinic_id=eq.${clinicId}`,
      },
      onChange,
    )
    .subscribe();

  return () => {
    if (channel) {
      void supabase.removeChannel(channel);
      channel = null;
    }
  };
}
