import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { Loader2, X } from 'lucide-react';
import { AppShell } from '../components/layout/LeftNav';
import { Spinner } from '../components/ui/Spinner';
import { useBriefs } from '../hooks/useBriefs';
import { useAccount } from '../hooks/useAccount';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../contexts/LanguageContext';
import type { IntelligenceBrief } from '../types/index';

// ── Alert types ───────────────────────────────────────────────────────────────

interface Alert {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: 'warning' | 'positive';
  created_at: string;
}

function useAlerts(accountId: string | undefined) {
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

function AlertBanner({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  const isWarning = alert.severity === 'warning';
  return (
    <div
      style={{
        borderLeft: `3px solid ${isWarning ? 'var(--gold)' : 'var(--green)'}`,
        background: isWarning ? 'var(--gold-faint)' : 'var(--green-bg)',
        borderRadius: 8,
        padding: '14px 16px',
        marginBottom: 12,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: isWarning ? 'var(--gold)' : 'var(--green)', marginBottom: 4 }}>
          {alert.title}
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
          {alert.message}
        </p>
      </div>
      <button
        onClick={onDismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--ink-faint)', flexShrink: 0 }}
        title="Got it"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, opts?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat('en-US', opts).format(n);
}

function greetingKey() {
  const h = new Date().getHours();
  return h < 12 ? 'dash.greeting.morning' : h < 17 ? 'dash.greeting.afternoon' : 'dash.greeting.evening';
}

/** Wrap dollar amounts in the text with a gold span. */
function HighlightNumbers({ text }: { text: string }) {
  const parts = text.split(/(\$[\d,]+(?:\.\d+)?)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('$') ? (
          <span key={i} style={{ color: 'var(--gold)', fontWeight: 500 }}>{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4" style={{ margin: '48px 0 32px' }}>
      <div style={{ flex: 1, height: 1, background: 'rgba(201,150,74,0.2)' }} />
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--ink-faint)', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'rgba(201,150,74,0.2)' }} />
    </div>
  );
}

function WorkingItem({
  when, whenColor, text, spinning,
}: {
  when: string; whenColor: string; text: string; spinning: boolean;
}) {
  return (
    <div
      className="flex items-start gap-5"
      style={{ padding: '14px 0', borderBottom: '1px solid rgba(201,150,74,0.1)' }}
    >
      <div className="flex items-center gap-1.5 flex-shrink-0" style={{ width: 88 }}>
        {spinning && <Loader2 size={11} className="animate-spin" style={{ color: whenColor }} />}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: whenColor }}>
          {when}
        </span>
      </div>
      <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.65 }}>{text}</p>
    </div>
  );
}

function PastBriefRow({ brief }: { brief: IntelligenceBrief }) {
  const { t } = useLanguage();
  const date = parseISO(brief.brief_date);
  const s = brief.section_yesterday;
  return (
    <div className="flex gap-5" style={{ padding: '20px 0', borderBottom: '1px solid rgba(201,150,74,0.1)' }}>
      {/* Day number */}
      <div className="flex-shrink-0" style={{ width: 48, paddingTop: 4 }}>
        <span
          className="font-display"
          style={{ fontSize: 40, color: 'var(--ink-faint)', lineHeight: 1 }}
        >
          {format(date, 'd')}
        </span>
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0">
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 6 }}>
          {format(date, 'EEEE, MMMM')}
        </p>
        {/* Summary comes from brief.section_yesterday.summary as stored in DB at generation time.
            Old briefs generated before the language/prompt fix will show their original text — this is expected.
            Only newly generated briefs will reflect prompt or language changes. */}
        {s?.summary && (
          <p className="line-clamp-2" style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.65, marginBottom: 8 }}>
            {s.summary}
          </p>
        )}
        <div className="flex items-center gap-4">
          {s?.revenue != null && (
            <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
              {fmt(s.revenue, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
            </span>
          )}
          {s?.orders != null && (
            <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
              {s.orders} orders
            </span>
          )}
          <Link
            to={`/briefs/${brief.id}`}
            className="ml-auto"
            style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 500 }}
          >
            {t('dash.readArrow')}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { account } = useAccount();
  const { briefs, loading, error, refetch } = useBriefs(account?.id);
  const { alerts, dismiss } = useAlerts(account?.id);
  const { t } = useLanguage();
  const firstName = account?.full_name?.split(' ')[0] ?? '';

  const [searchParams] = useSearchParams();
  const justConnected = searchParams.get('connected') === 'true';

  // Poll every 5s while waiting for first brief to generate
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!justConnected || loading || briefs.length > 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => { void refetch(); }, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [justConnected, loading, briefs.length, refetch]);

  const isGenerating = justConnected && !loading && briefs.length === 0;
  const latest = briefs[0] ?? null;
  const past = briefs.slice(1);

  // Build "What I'm working on" items (always 4)
  const topProduct = latest?.section_yesterday?.top_product;
  const issue = latest?.section_whats_not_working?.items[0];
  const gap = latest?.section_gap;

  const workingItems = [
    {
      when: t('when.tonight'), whenColor: 'var(--gold)', spinning: true,
      text: topProduct
        ? t('work.watching', { product: topProduct })
        : t('work.watchingDefault'),
    },
    {
      when: t('when.tonight'), whenColor: 'var(--gold)', spinning: true,
      text: issue
        ? `${issue.title} — ${issue.metric}`
        : t('work.checkingDefault'),
    },
    {
      when: t('when.tomorrow'), whenColor: 'var(--green)', spinning: false,
      text: t('work.briefReady'),
    },
    {
      when: t('when.thisWeek'), whenColor: 'var(--ink-faint)', spinning: false,
      text: gap
        ? gap.gap.replace(/\.$/, '')
        : t('work.gapDefault'),
    },
  ];

  return (
    <AppShell>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '64px 32px 80px' }}>

        {/* ── Loading ── */}
        {loading && (
          <div className="flex justify-center" style={{ paddingTop: 64 }}>
            <Spinner size="lg" />
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: 16, fontSize: 14, color: '#DC2626' }}>
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Top line: date + status pill */}
            <div className="flex items-center justify-between" style={{ marginBottom: 32 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
                {format(new Date(), 'EEEE, MMMM d')}
              </span>
              <span
                className="flex items-center gap-2"
                style={{ background: 'var(--green-bg)', color: 'var(--green)', fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 999 }}
              >
                <span className="relative flex" style={{ width: 7, height: 7 }}>
                  <span className="agent-pulse absolute inline-flex rounded-full" style={{ width: '100%', height: '100%', background: '#2D6A4F', opacity: 0.5 }} />
                  <span className="relative inline-flex rounded-full" style={{ width: 7, height: 7, background: '#2D6A4F' }} />
                </span>
                {t('dash.statusPill')}
              </span>
            </div>

            {/* Alert banners */}
            {alerts.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                {alerts.map(a => (
                  <AlertBanner key={a.id} alert={a} onDismiss={() => void dismiss(a.id)} />
                ))}
              </div>
            )}

            {/* Greeting */}
            <h1
              className="font-display fade-up"
              style={{ fontSize: 44, color: 'var(--ink)', lineHeight: 1.15, marginBottom: 20 }}
            >
              {t(greetingKey())}{firstName ? `, ${firstName}` : ''}.
            </h1>

            {/* Generating state */}
            {isGenerating && (
              <div className="fade-up-2" style={{ marginBottom: 32 }}>
                <div className="flex items-center gap-3" style={{ marginBottom: 8 }}>
                  <Loader2 size={16} className="animate-spin" style={{ color: 'var(--gold)' }} />
                  <p style={{ fontSize: 19, fontWeight: 300, color: 'var(--ink)', lineHeight: 1.65 }}>
                    {t('dash.generating.title')}
                  </p>
                </div>
                <p style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.65 }}>
                  {t('dash.generating.body')}
                </p>
              </div>
            )}

            {/* Empty state */}
            {!latest && !isGenerating && (
              <div className="fade-up-2">
                <p style={{ fontSize: 19, fontWeight: 300, color: 'var(--ink)', lineHeight: 1.65, marginBottom: 16 }}>
                  {t('dash.empty.title')}
                </p>
                <p style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.65 }}>
                  Make sure your Shopify store is connected in{' '}
                  <a href="/settings" style={{ color: 'var(--gold)' }}>{t('dash.empty.settingsWord')}</a>.
                </p>
              </div>
            )}

            {/* Latest brief */}
            {latest && (
              <>
                {/* Analyst message */}
                {latest.section_yesterday?.summary && (
                  <p
                    className="fade-up-2"
                    style={{ fontSize: 19, fontWeight: 300, color: 'var(--ink)', lineHeight: 1.7, marginBottom: 32 }}
                  >
                    <HighlightNumbers text={latest.section_yesterday.summary} />
                  </p>
                )}

                {/* CTA */}
                <div className="flex items-center gap-5 fade-up-3" style={{ marginBottom: 0 }}>
                  <Link
                    to={`/briefs/${latest.id}`}
                    style={{
                      display: 'inline-block',
                      background: 'var(--ink)',
                      color: 'var(--cream)',
                      borderRadius: 8,
                      padding: '12px 22px',
                      fontSize: 14,
                      fontWeight: 600,
                      textDecoration: 'none',
                      transition: 'opacity 0.15s',
                    }}
                  >
                    {t('dash.cta')}
                  </Link>
                  <span style={{ fontSize: 13, color: 'var(--ink-faint)' }}>{t('dash.readTime')}</span>
                </div>
              </>
            )}

            {/* What I'm working on */}
            <SectionDivider label={t('dash.section.working')} />
            <div>
              {workingItems.map((item, i) => (
                <WorkingItem key={i} {...item} />
              ))}
            </div>

            {/* Previous briefings */}
            {past.length > 0 && (
              <>
                <SectionDivider label={t('dash.section.previous')} />
                <div>
                  {past.map(b => (
                    <PastBriefRow key={b.id} brief={b} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
