import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { AppShell } from '../components/layout/LeftNav';
import { Spinner } from '../components/ui/Spinner';
import { supabase } from '../lib/supabase';
import { useAccount } from '../hooks/useAccount';
import { useLanguage } from '../contexts/LanguageContext';

interface Alert {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: 'warning' | 'positive';
  created_at: string;
  read_at: string | null;
}

// ── Alert card (used for real alerts and examples) ────────────────────────────

function AlertCard({
  title,
  message,
  severity,
  unread,
  timestamp,
  example,
  onDismiss,
}: {
  title: string;
  message: string;
  severity: 'warning' | 'positive';
  unread: boolean;
  timestamp?: string;
  example?: boolean;
  onDismiss?: () => void;
}) {
  const { t, lang } = useLanguage();
  const accentColor = severity === 'warning' ? 'var(--gold)' : 'var(--green)';

  return (
    <div
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
          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: unread ? accentColor : 'var(--ink-muted)' }}>
              {title}
            </p>
            {example && (
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--ink-faint)',
                background: 'rgba(168,152,128,0.12)',
                borderRadius: 4,
                padding: '2px 6px',
                flexShrink: 0,
              }}>
                {lang === 'es' ? 'Ejemplo' : 'Example'}
              </span>
            )}
          </div>
          <p style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.65, marginBottom: 10 }}>
            {message}
          </p>
          {timestamp && (
            <div className="flex items-center gap-3">
              <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
                {formatDistanceToNow(parseISO(timestamp), { addSuffix: true })}
              </span>
              {!unread && (
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
                  {lang === 'es' ? 'leído' : 'read'}
                </span>
              )}
            </div>
          )}
        </div>
        {unread && !example && onDismiss && (
          <button
            onClick={onDismiss}
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
            {t('alerts.gotIt')}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Empty state with examples ─────────────────────────────────────────────────

function EmptyState({ t }: { t: ReturnType<typeof useLanguage>['t'] }) {
  return (
    <div>
      <p style={{ fontSize: 15, color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: 32 }}>
        {t('alerts.empty')}
      </p>
      <div style={{ marginBottom: 24 }}>
        <AlertCard
          title={t('alerts.example1.title')}
          message={t('alerts.example1.message')}
          severity="warning"
          unread={true}
          example={true}
        />
        <AlertCard
          title={t('alerts.example2.title')}
          message={t('alerts.example2.message')}
          severity="positive"
          unread={true}
          example={true}
        />
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink-faint)', lineHeight: 1.65 }}>
        {t('alerts.exampleNote')}
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Alerts() {
  const { account } = useAccount();
  const { t } = useLanguage();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    if (!account?.id) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/alerts`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`[Alerts] GET /api/alerts failed — status ${res.status}:`, body);
        setLoading(false);
        return;
      }

      const json = await res.json() as { alerts: Alert[] };
      console.log('[Alerts] loaded:', json.alerts?.length ?? 0, 'alerts');
      setAlerts(json.alerts ?? []);
    } catch (err) {
      console.error('[Alerts] fetch error:', err);
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
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/alerts/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      console.error('[Alerts] PATCH /read failed — status', res.status);
    }
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '64px 32px 80px' }}>

        <h1
          className="font-display fade-up"
          style={{ fontSize: 44, color: 'var(--ink)', lineHeight: 1.15, marginBottom: 12 }}
        >
          {t('alerts.title')}
        </h1>
        <p
          className="fade-up-2"
          style={{ fontSize: 15, color: 'var(--ink-faint)', lineHeight: 1.65, marginBottom: 48 }}
        >
          {t('alerts.subtitle')}
        </p>

        {loading && (
          <div className="flex justify-center" style={{ paddingTop: 48 }}>
            <Spinner size="lg" />
          </div>
        )}

        {!loading && alerts.length === 0 && <EmptyState t={t} />}

        {!loading && alerts.length > 0 && (
          <div>
            {alerts.map(alert => (
              <AlertCard
                key={alert.id}
                title={alert.title}
                message={alert.message}
                severity={alert.severity}
                unread={!alert.read_at}
                timestamp={alert.created_at}
                onDismiss={() => void dismiss(alert.id)}
              />
            ))}
          </div>
        )}

      </div>
    </AppShell>
  );
}
