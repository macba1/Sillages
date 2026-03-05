import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { AppShell } from '../components/layout/LeftNav';
import { Spinner } from '../components/ui/Spinner';
import { supabase } from '../lib/supabase';
import { useAccount } from '../hooks/useAccount';

interface Alert {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: 'warning' | 'positive';
  created_at: string;
  read_at: string | null;
}

export default function Alerts() {
  const { account } = useAccount();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    if (!account?.id) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/alerts`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error(`Failed to load alerts`);
      const { alerts: data } = await res.json() as { alerts: Alert[] };
      setAlerts(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [account?.id]);

  useEffect(() => { void fetchAlerts(); }, [fetchAlerts]);

  async function dismiss(id: string) {
    setAlerts(prev =>
      prev.map(a => a.id === id ? { ...a, read_at: new Date().toISOString() } : a)
    );
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(`${import.meta.env.VITE_API_URL}/api/alerts/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '64px 32px 80px' }}>

        <h1
          className="font-display fade-up"
          style={{ fontSize: 44, color: 'var(--ink)', lineHeight: 1.15, marginBottom: 12 }}
        >
          Alerts.
        </h1>
        <p
          className="fade-up-2"
          style={{ fontSize: 15, color: 'var(--ink-faint)', lineHeight: 1.65, marginBottom: 48 }}
        >
          Things I noticed that I thought you should know about.
        </p>

        {loading && (
          <div className="flex justify-center" style={{ paddingTop: 48 }}>
            <Spinner size="lg" />
          </div>
        )}

        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: 16, fontSize: 14, color: '#DC2626' }}>
            {error}
          </div>
        )}

        {!loading && !error && alerts.length === 0 && (
          <p style={{ fontSize: 15, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
            Nothing to flag right now. I'll let you know when something catches my attention.
          </p>
        )}

        {!loading && !error && alerts.length > 0 && (
          <div>
            {alerts.map(alert => {
              const unread = !alert.read_at;
              const isWarning = alert.severity === 'warning';
              const accentColor = isWarning ? 'var(--gold)' : 'var(--green)';

              return (
                <div
                  key={alert.id}
                  style={{
                    opacity: unread ? 1 : 0.6,
                    borderLeft: unread ? `4px solid ${accentColor}` : '4px solid transparent',
                    paddingLeft: 16,
                    paddingTop: 20,
                    paddingBottom: 20,
                    borderBottom: '1px solid rgba(201,150,74,0.1)',
                    transition: 'opacity 0.2s',
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: unread ? accentColor : 'var(--ink-muted)',
                          marginBottom: 6,
                        }}
                      >
                        {alert.title}
                      </p>
                      <p style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.65, marginBottom: 10 }}>
                        {alert.message}
                      </p>
                      <div className="flex items-center gap-3">
                        <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
                          {formatDistanceToNow(parseISO(alert.created_at), { addSuffix: true })}
                        </span>
                        {!unread && (
                          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
                            read
                          </span>
                        )}
                      </div>
                    </div>
                    {unread && (
                      <button
                        onClick={() => void dismiss(alert.id)}
                        style={{
                          flexShrink: 0,
                          background: 'none',
                          border: '1px solid rgba(201,150,74,0.3)',
                          borderRadius: 6,
                          padding: '6px 12px',
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--ink-muted)',
                          cursor: 'pointer',
                          fontFamily: "'DM Sans', sans-serif",
                          transition: 'border-color 0.15s, color 0.15s',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Got it
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </AppShell>
  );
}
