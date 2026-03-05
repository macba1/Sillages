import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useUnreadAlerts(accountId: string | undefined) {
  const [hasUnread, setHasUnread] = useState(false);

  const check = useCallback(async () => {
    if (!accountId) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/alerts?unread=true`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (!res.ok) return;
      const { alerts } = await res.json() as { alerts: unknown[] };
      setHasUnread((alerts ?? []).length > 0);
    } catch {
      // non-fatal
    }
  }, [accountId]);

  useEffect(() => { void check(); }, [check]);

  return { hasUnread };
}
