import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { Loader2, X } from 'lucide-react';
import { AppShell } from '../components/layout/LeftNav';
import { Spinner } from '../components/ui/Spinner';
import { useBriefs } from '../hooks/useBriefs';
import { useAccount } from '../hooks/useAccount';
import { useAlerts } from '../hooks/useAlerts';
import type { Alert } from '../hooks/useAlerts';
import { useLanguage } from '../contexts/LanguageContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useIsPWA } from '../hooks/useIsPWA';
import type { IntelligenceBrief } from '../types/index';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, opts?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat('en-US', opts).format(n);
}

function greetingKey() {
  const h = new Date().getHours();
  return h < 12 ? 'dash.greeting.morning' : h < 17 ? 'dash.greeting.afternoon' : 'dash.greeting.evening';
}

function HighlightNumbers({ text }: { text: string }) {
  const parts = text.split(/(\$[\d,]+(?:\.\d+)?)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('$')
          ? <span key={i} style={{ color: 'var(--gold)', fontWeight: 500 }}>{part}</span>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

// ── Alert banner ──────────────────────────────────────────────────────────────

function AlertBanner({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  const isWarning = alert.severity === 'warning';
  return (
    <div style={{
      borderLeft: `3px solid ${isWarning ? 'var(--gold)' : 'var(--green)'}`,
      background: isWarning ? 'var(--gold-faint)' : 'var(--green-bg)',
      borderRadius: 8,
      padding: '14px 16px',
      marginBottom: 12,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: isWarning ? 'var(--gold)' : 'var(--green)', marginBottom: 4 }}>
          {alert.title}
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6 }}>{alert.message}</p>
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

// ── Metric tile ───────────────────────────────────────────────────────────────

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: 'var(--cream-dark)',
      borderRadius: 16,
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <span style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--gold)',
      }}>
        {label}
      </span>
      <span className="font-display" style={{ fontSize: 36, color: 'var(--ink)', lineHeight: 1.1 }}>
        {value}
      </span>
    </div>
  );
}

// ── Working card ──────────────────────────────────────────────────────────────

function WorkingCard({ when, whenColor, text, spinning }: {
  when: string; whenColor: string; text: string; spinning: boolean;
}) {
  return (
    <div style={{
      background: 'var(--white)',
      borderRadius: 16,
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 16,
      flex: '1 1 280px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, paddingTop: 2 }}>
        {spinning && <Loader2 size={10} className="animate-spin" style={{ color: whenColor }} />}
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: whenColor,
          whiteSpace: 'nowrap',
        }}>
          {when}
        </span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>{text}</p>
    </div>
  );
}

// ── Past brief card ───────────────────────────────────────────────────────────

function PastBriefCard({ brief }: { brief: IntelligenceBrief }) {
  const { t } = useLanguage();
  const date = parseISO(brief.brief_date);
  const s = brief.section_yesterday;
  return (
    <div style={{
      background: 'var(--white)',
      borderRadius: 16,
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      flexShrink: 0,
      width: 260,
    }}>
      {/* Date number */}
      <span className="font-display" style={{ fontSize: 44, color: 'var(--ink-faint)', lineHeight: 1 }}>
        {format(date, 'd')}
      </span>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-faint)', margin: 0 }}>
        {format(date, 'EEEE, MMMM')}
      </p>
      {/* Summary — stored at generation time; old briefs show original text */}
      {s?.summary && (
        <p className="line-clamp-2" style={{ fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6, margin: 0 }}>
          {s.summary}
        </p>
      )}
      {/* Stats row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 'auto' }}>
        {s?.revenue != null && (
          <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
            {fmt(s.revenue, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
          </span>
        )}
        {s?.orders != null && (
          <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
            {s.orders} {t('dash.orders')}
          </span>
        )}
        <Link
          to={`/briefs/${brief.id}`}
          style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--gold)', fontWeight: 600, textDecoration: 'none' }}
        >
          {t('dash.readArrow')}
        </Link>
      </div>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
      <span style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'rgba(201,150,74,0.2)' }} />
    </div>
  );
}

// ── Push notification modal ───────────────────────────────────────────────────

function PushModal({ onActivate, onDismiss, t }: { onActivate: () => void; onDismiss: () => void; t: (k: string) => string }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(42,31,20,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: 'var(--white)', borderRadius: 16, padding: '32px 28px',
        maxWidth: 380, width: '100%', textAlign: 'center',
        boxShadow: '0 20px 60px rgba(42,31,20,0.2)',
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔔</div>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 8, lineHeight: 1.3 }}>
          {t('push.modal.title')}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.6, marginBottom: 24 }}>
          {t('push.modal.body')}
        </p>
        <button
          onClick={onActivate}
          style={{
            width: '100%', padding: '12px 20px', borderRadius: 10,
            background: 'var(--ink)', color: 'var(--cream)',
            fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif", marginBottom: 10,
          }}
        >
          {t('push.modal.activate')}
        </button>
        <button
          onClick={onDismiss}
          style={{
            width: '100%', padding: '10px 20px', borderRadius: 10,
            background: 'transparent', color: 'var(--ink-faint)',
            fontSize: 13, border: 'none', cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          {t('push.modal.later')}
        </button>
      </div>
    </div>
  );
}

// ── PWA install banner ───────────────────────────────────────────────────────

function PWABanner({ variant, onInstall, onDismiss, t }: {
  variant: 'native' | 'ios';
  onInstall: () => void;
  onDismiss: () => void;
  t: (k: string) => string;
}) {
  return (
    <div style={{
      background: 'var(--white)', borderRadius: 12,
      border: '1px solid rgba(201,150,74,0.2)',
      padding: '14px 18px', marginBottom: 20,
      display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <span style={{ fontSize: 24, flexShrink: 0 }}>📱</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
          {t('pwa.banner.title')}
        </p>
        <p style={{ fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.5, margin: 0 }}>
          {variant === 'ios' ? t('pwa.banner.ios') : t('pwa.banner.native')}
        </p>
      </div>
      {variant === 'native' && (
        <button
          onClick={onInstall}
          style={{
            padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: 'var(--ink)', color: 'var(--cream)',
            border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          {t('pwa.banner.install')}
        </button>
      )}
      <button
        onClick={onDismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--ink-faint)', flexShrink: 0 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { account } = useAccount();
  const { briefs, loading, error, refetch } = useBriefs(account?.id);
  const { alerts, dismiss } = useAlerts(account?.id);
  const { t, lang, setLang } = useLanguage();
  const firstName = account?.full_name?.split(' ')[0] ?? '';
  const isPWA = useIsPWA();

  // Pull-to-refresh for PWA
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef<{ startY: number; pulling: boolean }>({ startY: 0, pulling: false });
  const [pullDistance, setPullDistance] = useState(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isPWA) return;
    const scrollEl = e.currentTarget;
    if (scrollEl.scrollTop <= 0) {
      pullRef.current = { startY: e.touches[0].clientY, pulling: true };
    }
  }, [isPWA]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPWA || !pullRef.current.pulling) return;
    const delta = e.touches[0].clientY - pullRef.current.startY;
    if (delta > 0) {
      setPullDistance(Math.min(delta * 0.4, 80));
    }
  }, [isPWA]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPWA || !pullRef.current.pulling) return;
    pullRef.current.pulling = false;
    if (pullDistance > 50) {
      setRefreshing(true);
      await refetch();
      setRefreshing(false);
    }
    setPullDistance(0);
  }, [isPWA, pullDistance, refetch]);

  // Push notifications
  const push = usePushNotifications();
  const [showPushModal, setShowPushModal] = useState(false);
  const pushModalShown = useRef(false);

  // Show push modal once when user has briefs and hasn't subscribed
  useEffect(() => {
    if (push.state === 'prompt' && briefs.length > 0 && !pushModalShown.current) {
      const dismissed = localStorage.getItem('sillages_push_dismissed');
      if (!dismissed) {
        pushModalShown.current = true;
        // Delay a bit so the page renders first
        const timer = setTimeout(() => setShowPushModal(true), 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [push.state, briefs.length]);

  // PWA install
  const pwa = usePWAInstall();

  const [searchParams] = useSearchParams();
  const justConnected = searchParams.get('connected') === 'true';
  const justReconnected = searchParams.get('reconnected') === 'true';

  // Poll every 5s while waiting for first brief to generate
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if ((!justConnected && !justReconnected) || loading || briefs.length > 0) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    intervalRef.current = setInterval(() => { void refetch(); }, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [justConnected, loading, briefs.length, refetch]);

  const isGenerating = (justConnected || justReconnected) && !loading && briefs.length === 0;
  const latest = briefs[0] ?? null;
  const past = briefs.slice(1);

  const topProduct = latest?.section_yesterday?.top_product;
  const issue = latest?.section_whats_not_working?.items[0];
  const gap = latest?.section_gap;

  const workingItems = [
    {
      when: t('when.tonight'), whenColor: 'var(--gold)', spinning: true,
      text: topProduct ? t('work.watching', { product: topProduct }) : t('work.watchingDefault'),
    },
    {
      when: t('when.tonight'), whenColor: 'var(--gold)', spinning: true,
      text: issue ? `${issue.title} — ${issue.metric}` : t('work.checkingDefault'),
    },
    {
      when: t('when.tomorrow'), whenColor: 'var(--green)', spinning: false,
      text: t('work.briefReady'),
    },
    {
      when: t('when.thisWeek'), whenColor: 'var(--ink-faint)', spinning: false,
      text: gap ? gap.gap.replace(/\.$/, '') : t('work.gapDefault'),
    },
  ];

  // Metric labels by language
  const metricLabels = lang === 'es'
    ? { revenue: 'Ingresos', orders: 'Pedidos', sessions: 'Visitantes', conversion: 'Conversión' }
    : { revenue: 'Revenue', orders: 'Orders', sessions: 'Visitors', conversion: 'Conversion' };

  const y = latest?.section_yesterday;
  const metrics = [
    {
      label: metricLabels.revenue,
      value: y ? fmt(y.revenue, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—',
    },
    { label: metricLabels.orders,  value: y ? fmt(y.orders) : '—' },
    { label: metricLabels.sessions, value: y ? fmt(y.sessions) : '—' },
    { label: metricLabels.conversion, value: y ? `${(y.conversion_rate * 100).toFixed(1)}%` : '—' },
  ];

  return (
    <AppShell>
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ maxWidth: 1440, margin: '0 auto', padding: isPWA ? '24px 16px 24px' : '48px 40px 80px' }}
      >

        {/* Pull-to-refresh indicator */}
        {isPWA && (pullDistance > 0 || refreshing) && (
          <div style={{
            display: 'flex', justifyContent: 'center', padding: '8px 0',
            opacity: refreshing ? 1 : Math.min(pullDistance / 50, 1),
            transition: refreshing ? 'none' : 'opacity 0.1s',
          }}>
            <Loader2
              size={20}
              className={refreshing ? 'animate-spin' : ''}
              style={{ color: 'var(--gold)', transform: `rotate(${pullDistance * 3}deg)` }}
            />
          </div>
        )}

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
            {/* ── TOP ROW ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isPWA ? 32 : 56, flexWrap: 'wrap', gap: 12 }}>
              {/* Left: date + status pill */}
              <div style={{ display: 'flex', alignItems: 'center', gap: isPWA ? 10 : 16, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
                  {format(new Date(), 'EEEE, MMMM d')}
                </span>
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  background: 'var(--green-bg)', color: 'var(--green)',
                  fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 999,
                }}>
                  <span style={{ position: 'relative', display: 'flex', width: 7, height: 7 }}>
                    <span className="agent-pulse" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#2D6A4F', opacity: 0.5 }} />
                    <span style={{ position: 'relative', width: 7, height: 7, borderRadius: '50%', background: '#2D6A4F', display: 'inline-flex' }} />
                  </span>
                  {t('dash.statusPill')}
                </span>
              </div>

              {/* Right: language toggle */}
              <div style={{ display: 'flex', gap: 2, background: 'var(--cream-dark)', borderRadius: 8, padding: 3 }}>
                {(['en', 'es'] as const).map(l => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    style={{
                      background: lang === l ? 'var(--white)' : 'transparent',
                      border: 'none',
                      borderRadius: 6,
                      padding: '5px 12px',
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: lang === l ? 'var(--ink)' : 'var(--ink-faint)',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Push notification modal ── */}
            {showPushModal && (
              <PushModal
                t={t}
                onActivate={async () => {
                  await push.subscribe();
                  setShowPushModal(false);
                }}
                onDismiss={() => {
                  setShowPushModal(false);
                  localStorage.setItem('sillages_push_dismissed', '1');
                }}
              />
            )}

            {/* ── PWA install banner ── */}
            {pwa.showNativePrompt && (
              <PWABanner variant="native" onInstall={() => void pwa.install()} onDismiss={pwa.dismiss} t={t} />
            )}
            {pwa.showIOSInstructions && (
              <PWABanner variant="ios" onInstall={() => {}} onDismiss={pwa.dismiss} t={t} />
            )}

            {/* ── Alert banners ── */}
            {alerts.length > 0 && (
              <div style={{ marginBottom: 32 }}>
                {alerts.map(a => (
                  <AlertBanner key={a.id} alert={a} onDismiss={() => void dismiss(a.id)} />
                ))}
              </div>
            )}

            {/* ── HERO SECTION — 60/40 split on desktop, stacked on mobile ── */}
            <div style={{ display: 'grid', gridTemplateColumns: isPWA ? '1fr' : '3fr 2fr', gap: isPWA ? 20 : 32, marginBottom: isPWA ? 40 : 72, alignItems: 'center' }}>

              {/* Left: greeting + analyst message + CTA */}
              <div>
                <h1 className="font-display fade-up" style={{ fontSize: isPWA ? 32 : 48, color: 'var(--ink)', lineHeight: 1.1, marginBottom: isPWA ? 14 : 20 }}>
                  {t(greetingKey())}{firstName ? `, ${firstName.toLowerCase()}` : ''}.
                </h1>

                {justReconnected && (
                  <div className="fade-up-2" style={{
                    background: 'rgba(34,139,34,0.08)', borderRadius: 10,
                    padding: '14px 18px', marginBottom: 20,
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{ fontSize: 18 }}>&#x2705;</span>
                    <p style={{ fontSize: 14, color: '#2A1F14', margin: 0 }}>
                      {t('reconnect.success')}
                    </p>
                  </div>
                )}

                {isGenerating && (
                  <div className="fade-up-2" style={{ marginBottom: 28 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <Loader2 size={16} className="animate-spin" style={{ color: 'var(--gold)' }} />
                      <p style={{ fontSize: 19, fontWeight: 300, color: 'var(--ink)', lineHeight: 1.65, margin: 0 }}>
                        {t('dash.generating.title')}
                      </p>
                    </div>
                    <p style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.65 }}>
                      {t('dash.generating.body')}
                    </p>
                  </div>
                )}

                {!latest && !isGenerating && (
                  <div className="fade-up-2">
                    <p style={{ fontSize: 19, fontWeight: 300, color: 'var(--ink)', lineHeight: 1.65, marginBottom: 12 }}>
                      {t('dash.empty.title')}
                    </p>
                    <p style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.65 }}>
                      <a href="/settings" style={{ color: 'var(--gold)' }}>{t('dash.empty.settingsWord')}</a>
                    </p>
                  </div>
                )}

                {latest && (
                  <div className="fade-up-2">
                    {latest.section_yesterday?.summary && (
                      <p style={{ fontSize: 19, fontWeight: 300, color: 'var(--ink)', lineHeight: 1.7, marginBottom: 32 }}>
                        <HighlightNumbers text={latest.section_yesterday.summary} />
                      </p>
                    )}
                    <Link
                      to={`/briefs/${latest.id}`}
                      style={{
                        display: 'inline-block',
                        background: 'var(--ink)',
                        color: 'var(--cream)',
                        borderRadius: 10,
                        padding: '13px 24px',
                        fontSize: 14,
                        fontWeight: 600,
                        textDecoration: 'none',
                        transition: 'opacity 0.15s',
                      }}
                    >
                      {t('dash.cta')}
                    </Link>
                  </div>
                )}
              </div>

              {/* Right: 2x2 metric tiles */}
              {latest && y && (
                <div className="fade-up-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {metrics.map(m => (
                    <MetricTile key={m.label} label={m.label} value={m.value} />
                  ))}
                </div>
              )}
            </div>

            {/* ── MIDDLE ROW: What I'm working on ── */}
            <div style={{ marginBottom: isPWA ? 32 : 64 }}>
              <SectionHeader label={t('dash.section.working')} />
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
              }}>
                {workingItems.map((item, i) => (
                  <WorkingCard key={i} {...item} />
                ))}
              </div>
            </div>

            {/* ── BOTTOM ROW: Previous briefs ── */}
            {past.length > 0 && (
              <div>
                <SectionHeader label={t('dash.section.previous')} />
                <div style={{
                  display: 'flex',
                  gap: 12,
                  overflowX: 'auto',
                  paddingBottom: 8,
                  scrollbarWidth: 'none',
                }}>
                  {past.map(b => (
                    <PastBriefCard key={b.id} brief={b} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
