import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface Alert {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: 'warning' | 'positive';
  created_at: string;
}

export function useAlerts(accountId: string | undefined) {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const fetchAlerts = useCallback(async () => {
    if (!accountId) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/alerts?unread=true`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const { alerts: data } = await res.json() as { alerts: Alert[] };
      setAlerts(data ?? []);
    } catch {
      // non-fatal
    }
  }, [accountId]);

  useEffect(() => { void fetchAlerts(); }, [fetchAlerts]);

  async function dismiss(id: string) {
    setAlerts(prev => prev.filter(a => a.id !== id));
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(`${import.meta.env.VITE_API_URL}/api/alerts/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  }

  return { alerts, dismiss };
}
