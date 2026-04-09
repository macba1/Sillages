import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import api from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Store {
  account_id: string;
  email: string;
  name: string | null;
  subscription: string;
  shop_domain: string | null;
  shop_name: string | null;
  token_status: string;
  token_failing_since: string | null;
  last_brief_date: string | null;
  last_brief_status: string | null;
  last_brief_generated_at: string | null;
  last_brief_error: string | null;
  last_action_type: string | null;
  last_action_title: string | null;
  last_action_executed: string | null;
  push_subscriptions: number;
  last_comm_channel: string | null;
  last_comm_status: string | null;
  last_comm_at: string | null;
  last_weekly_week: string | null;
  last_weekly_status: string | null;
  last_weekly_sent_at: string | null;
}

interface AdminAlert {
  id: string;
  alert_type: string;
  account_id: string | null;
  message: string;
  sent_at: string;
}

interface DeliveryLog {
  account_email: string;
  channel: string;
  status: string;
  sent_at: string;
  error_message: string | null;
  brief_id: string | null;
  weekly_brief_id: string | null;
}

interface SystemHealth {
  overall_status: string;
  ok: number;
  auto_fixed: number;
  needs_attention: number;
  last_run: string | null;
  auto_fixed_details: Array<{ check_name: string; details: unknown }>;
  needs_attention_details: Array<{ check_name: string; status: string; details: unknown }>;
}

interface GlobalMetrics {
  emails_sent: number;
  pushes_sent: number;
  carts_recovered: number;
  recovery_revenue: number;
}

interface StatusData {
  stores: Store[];
  system_health: SystemHealth;
  recent_alerts: AdminAlert[];
  last_audit: { ran_at: string; alerts_count: number; duration_ms: number } | null;
  recent_deliveries?: DeliveryLog[];
  global_metrics: GlobalMetrics;
  server_time: string;
}

interface EmailLog {
  id: string;
  account_id: string;
  channel: string;
  status: string;
  sent_at: string;
  error_message: string | null;
  message_id: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
  account_email: string | null;
  shop_name: string | null;
}

interface EmailFunnel {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
}

interface RecoveryStats {
  total_carts: number;
  recovered: number;
  revenue: number;
  by_sillages?: number;
  by_sillages_revenue?: number;
  organic?: number;
  organic_revenue?: number;
}

interface OrchestratorData {
  overall_status: string;
  summary: { ok: number; auto_fixed: number; needs_attention: number; auto_fixes_24h: number };
  checks_ok: Array<Record<string, unknown>>;
  checks_auto_fixed: Array<Record<string, unknown>>;
  checks_needs_attention: Array<Record<string, unknown>>;
  history_24h: Array<Record<string, unknown>>;
  last_run: string | null;
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const S = {
  page: { minHeight: '100vh', background: '#f9fafb', color: '#1f2937', padding: '20px 24px', fontFamily: "'DM Sans', 'SF Mono', monospace", fontSize: 13 } as const,
  card: { background: '#ffffff', borderRadius: 10, border: '1px solid #e5e7eb', marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' } as const,
  cardHeader: { padding: '14px 18px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as const,
  cardBody: { padding: '14px 18px' } as const,
  h2: { fontSize: 15, fontWeight: 700, color: '#111827', margin: 0 } as const,
  badge: (bg: string, text: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', background: bg, color: text }),
  btn: (bg: string) => ({ background: bg, color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }),
  tab: (active: boolean) => ({ background: active ? '#C9964A' : '#f3f4f6', color: active ? '#fff' : '#6b7280', border: active ? 'none' : '1px solid #e5e7eb', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }),
  muted: { color: '#9ca3af', fontSize: 12 } as const,
  label: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: '#9ca3af', marginBottom: 4 } as const,
};

function statusBadge(status: string) {
  const map: Record<string, [string, string]> = {
    ok: ['#2D6A4F', '#fff'],
    auto_fixed: ['#C9964A', '#000'],
    warning: ['#C9964A', '#000'],
    critical: ['#dc3545', '#fff'],
    sent: ['#2D6A4F', '#fff'],
    healthy: ['#2D6A4F', '#fff'],
    invalid: ['#dc3545', '#fff'],
    failing: ['#C9964A', '#000'],
    completed: ['#2D6A4F', '#fff'],
    failed: ['#dc3545', '#fff'],
    pending: ['#C9964A', '#000'],
  };
  const [bg, text] = map[status] ?? ['#e5e7eb', '#374151'];
  return S.badge(bg, text);
}

function channelBadge(channel: string) {
  const map: Record<string, [string, string]> = {
    push: ['#004085', '#cce5ff'],
    email: ['#856404', '#fff3cd'],
    weekly_email: ['#155724', '#d4edda'],
    event_push: ['#3d0066', '#e6ccff'],
    daily_summary_push: ['#004085', '#cce5ff'],
    brief: ['#856404', '#fff3cd'],
  };
  const [bg, text] = map[channel] ?? ['#e5e7eb', '#374151'];
  return S.badge(bg, text);
}

function timeAgo(date: string | null): string {
  if (!date) return '—';
  try { return formatDistanceToNow(parseISO(date), { addSuffix: true, locale: es }); } catch { return date; }
}

function shortTime(date: string | null): string {
  if (!date) return '—';
  try {
    const d = parseISO(date);
    return `${d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  } catch { return date; }
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'orchestrator' | 'emails';

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminStatus() {
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<StatusData | null>(null);
  const [orchData, setOrchData] = useState<OrchestratorData | null>(null);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [emailFunnel, setEmailFunnel] = useState<EmailFunnel>({ sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 });
  const [recoveryStats, setRecoveryStats] = useState<RecoveryStats>({ total_carts: 0, recovered: 0, revenue: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, orchRes, emailRes] = await Promise.all([
        api.get('/api/admin/status'),
        api.get('/api/admin/orchestrator').catch(() => ({ data: null })),
        api.get('/api/admin/email-tracking').catch(() => ({ data: { logs: [], funnel: { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 }, recovery: { total_carts: 0, recovered: 0, revenue: 0 } } })),
      ]);
      setData(statusRes.data);
      setOrchData(orchRes.data);
      setEmailLogs(emailRes.data.logs ?? []);
      setEmailFunnel(emailRes.data.funnel ?? { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 });
      setRecoveryStats(emailRes.data.recovery ?? { total_carts: 0, recovered: 0, revenue: 0 });
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (loading) return <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p>Loading...</p></div>;
  if (error) return <div style={S.page}><h1 style={{ color: '#dc2626' }}>Error: {error}</h1></div>;
  if (!data) return null;

  const healthColor = {
    ok: '#2D6A4F',
    auto_fixed: '#C9964A',
    warning: '#C9964A',
    critical: '#dc3545',
    unknown: '#9ca3af',
  }[data.system_health.overall_status] ?? '#9ca3af';

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>Sillages Monitoring</h1>
          <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
            Server: {data.server_time.slice(11, 19)} UTC | Refresh: {lastRefresh.toLocaleTimeString()} | Auto: 30s
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchAll} style={{ ...S.btn('#f3f4f6'), color: '#374151', border: '1px solid #e5e7eb' }}>Refresh</button>
        </div>
      </div>

      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Stores', value: data.stores.length, color: '#004085' },
          { label: 'System Health', value: data.system_health.overall_status.toUpperCase(), color: healthColor },
          { label: 'Emails Sent', value: data.global_metrics.emails_sent, color: '#2D6A4F' },
          { label: 'Pushes Sent', value: data.global_metrics.pushes_sent, color: '#004085' },
          { label: 'Carts Recovered', value: data.global_metrics.carts_recovered, color: '#C9964A' },
          { label: 'Recovery Revenue', value: `\u20AC${data.global_metrics.recovery_revenue.toFixed(0)}`, color: '#8B5CF6' },
          { label: 'Alerts', value: data.recent_alerts.length, color: data.recent_alerts.length > 0 ? '#dc3545' : '#2D6A4F' },
        ].map(s => (
          <div key={s.label} style={{ ...S.card, padding: '10px 16px', minWidth: 100, textAlign: 'center', marginBottom: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ ...S.label, marginBottom: 0 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {([
          ['overview', 'Stores & Alerts'],
          ['orchestrator', 'Orchestrator'],
          ['emails', 'Email Tracking'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={S.tab(tab === t)}>{label}</button>
        ))}
      </div>

      {/* ── TAB: Overview ─────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <>
          {/* Stores */}
          <div style={S.card}>
            <div style={S.cardHeader}><h2 style={S.h2}>Active Stores</h2></div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    {['Store', 'Email', 'Plan', 'Token', 'Brief', 'Push', 'Weekly', 'Last Comm'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 12px', ...S.label }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.stores.map(store => (
                    <tr key={store.account_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ fontWeight: 600, color: '#111827', fontSize: 13 }}>{store.shop_name ?? '—'}</div>
                        <div style={{ fontSize: 10, color: '#9ca3af' }}>{store.shop_domain ?? 'no connection'}</div>
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: '#6b7280' }}>{store.email}</td>
                      <td style={{ padding: '8px 12px' }}><span style={statusBadge(store.subscription)}>{store.subscription}</span></td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={statusBadge(store.token_status)}>{store.token_status}</span>
                        {store.token_failing_since && <div style={{ fontSize: 9, color: '#dc2626', marginTop: 2 }}>since {timeAgo(store.token_failing_since)}</div>}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {store.last_brief_date ? (
                          <div>
                            <span style={{ color: '#374151', fontSize: 12 }}>{store.last_brief_date}</span>
                            <div style={{ fontSize: 9, color: '#9ca3af' }}>{timeAgo(store.last_brief_generated_at)}</div>
                          </div>
                        ) : <span style={S.muted}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <span style={{ color: store.push_subscriptions > 0 ? '#4caf50' : '#9ca3af', fontWeight: 700 }}>{store.push_subscriptions}</span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {store.last_weekly_week ? (
                          <div>
                            <span style={statusBadge(store.last_weekly_status ?? 'unknown')}>{store.last_weekly_status}</span>
                            <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 2 }}>{store.last_weekly_week}</div>
                          </div>
                        ) : <span style={S.muted}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {store.last_comm_at ? (
                          <div>
                            <span style={channelBadge(store.last_comm_channel ?? 'unknown')}>{store.last_comm_channel}</span>
                            <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 2 }}>{timeAgo(store.last_comm_at)}</div>
                          </div>
                        ) : <span style={S.muted}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Alerts */}
          <div style={S.card}>
            <div style={S.cardHeader}><h2 style={S.h2}>Recent Alerts</h2></div>
            <div style={S.cardBody}>
              {data.recent_alerts.length === 0 ? (
                <p style={{ color: '#2D6A4F', fontSize: 13 }}>All clear</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.recent_alerts.slice(0, 10).map(alert => (
                    <div key={alert.id} style={{ padding: '8px 12px', borderLeft: `3px solid ${alert.alert_type.includes('critical') ? '#dc3545' : '#C9964A'}`, background: '#f9fafb', borderRadius: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: alert.alert_type.includes('critical') ? '#dc3545' : '#C9964A', textTransform: 'uppercase' }}>{alert.alert_type}</span>
                        <span style={{ fontSize: 10, color: '#9ca3af' }}>{timeAgo(alert.sent_at)}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 12, color: '#4b5563', lineHeight: 1.4 }}>{alert.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Deliveries */}
          {data.recent_deliveries && data.recent_deliveries.length > 0 && (
            <div style={S.card}>
              <div style={S.cardHeader}><h2 style={S.h2}>Recent Deliveries</h2></div>
              <div style={S.cardBody}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.recent_deliveries.slice(0, 15).map((d, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <span style={channelBadge(d.channel)}>{d.channel}</span>
                      <span style={statusBadge(d.status)}>{d.status}</span>
                      <span style={{ color: '#374151', fontSize: 12, flex: 1 }}>{d.account_email}</span>
                      <span style={{ fontSize: 10, color: '#9ca3af' }}>{shortTime(d.sent_at)}</span>
                      {d.error_message && <span style={{ fontSize: 10, color: '#dc3545' }}>{d.error_message}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── TAB: Orchestrator ─────────────────────────────────────────────────── */}
      {tab === 'orchestrator' && orchData && (
        <>
          {/* Overall status */}
          <div style={S.card}>
            <div style={S.cardHeader}>
              <h2 style={S.h2}>System Health</h2>
              <span style={statusBadge(orchData.overall_status)}>{orchData.overall_status}</span>
            </div>
            <div style={S.cardBody}>
              <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
                <div><span style={{ fontSize: 22, fontWeight: 700, color: '#2D6A4F' }}>{orchData.summary.ok}</span> <span style={S.muted}>OK</span></div>
                <div><span style={{ fontSize: 22, fontWeight: 700, color: '#C9964A' }}>{orchData.summary.auto_fixed}</span> <span style={S.muted}>Auto-Fixed</span></div>
                <div><span style={{ fontSize: 22, fontWeight: 700, color: '#dc3545' }}>{orchData.summary.needs_attention}</span> <span style={S.muted}>Needs Attention</span></div>
                <div><span style={{ fontSize: 22, fontWeight: 700, color: '#6b7280' }}>{orchData.summary.auto_fixes_24h}</span> <span style={S.muted}>Fixes (24h)</span></div>
              </div>
              <p style={S.muted}>Last run: {timeAgo(orchData.last_run)}</p>
            </div>
          </div>

          {/* Needs Attention */}
          {orchData.checks_needs_attention.length > 0 && (
            <div style={S.card}>
              <div style={S.cardHeader}><h2 style={{ ...S.h2, color: '#dc3545' }}>Needs Attention</h2></div>
              <div style={S.cardBody}>
                {orchData.checks_needs_attention.map((c, i) => (
                  <div key={i} style={{ padding: '8px 12px', borderLeft: '3px solid #dc3545', background: '#fef2f2', borderRadius: 4, marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: '#111827', fontSize: 12 }}>{String(c.check_name)}</span>
                      <span style={statusBadge(String(c.status))}>{String(c.status)}</span>
                    </div>
                    <pre style={{ margin: 0, fontSize: 10, color: '#6b7280', whiteSpace: 'pre-wrap' }}>{JSON.stringify(c.details, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Auto-Fixed */}
          {orchData.checks_auto_fixed.length > 0 && (
            <div style={S.card}>
              <div style={S.cardHeader}><h2 style={{ ...S.h2, color: '#C9964A' }}>Auto-Fixed</h2></div>
              <div style={S.cardBody}>
                {orchData.checks_auto_fixed.map((c, i) => (
                  <div key={i} style={{ padding: '8px 12px', borderLeft: '3px solid #C9964A', background: '#fffbeb', borderRadius: 4, marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, color: '#111827', fontSize: 12 }}>{String(c.check_name)}</span>
                    <pre style={{ margin: 0, fontSize: 10, color: '#6b7280', whiteSpace: 'pre-wrap', marginTop: 4 }}>{JSON.stringify(c.details, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent History */}
          <div style={S.card}>
            <div style={S.cardHeader}><h2 style={S.h2}>Last 24h History ({orchData.history_24h.length})</h2></div>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    {['Time', 'Check', 'Status', 'Auto-Fix'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 12px', ...S.label }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orchData.history_24h.slice(0, 50).map((h, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '6px 12px', fontSize: 10, color: '#9ca3af' }}>{shortTime(String(h.created_at))}</td>
                      <td style={{ padding: '6px 12px', fontSize: 11, color: '#374151' }}>{String(h.check_name)}</td>
                      <td style={{ padding: '6px 12px' }}><span style={statusBadge(String(h.status))}>{String(h.status)}</span></td>
                      <td style={{ padding: '6px 12px', fontSize: 11 }}>{h.auto_fixed ? 'Yes' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── TAB: Email Tracking ───────────────────────────────────────────────── */}
      {tab === 'emails' && (
        <>
          {/* Funnel + Recovery stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div style={S.card}>
              <div style={S.cardHeader}><h2 style={S.h2}>Email Funnel</h2></div>
              <div style={{ padding: '16px 18px' }}>
                {(() => {
                  const steps = [
                    { label: 'Sent', value: emailFunnel.sent, color: '#4a90d9' },
                    { label: 'Delivered', value: emailFunnel.delivered, color: '#2D6A4F' },
                    { label: 'Opened', value: emailFunnel.opened, color: '#C9964A' },
                    { label: 'Clicked', value: emailFunnel.clicked, color: '#8B5CF6' },
                  ];
                  const max = Math.max(emailFunnel.sent, 1);
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {steps.map(s => (
                        <div key={s.label}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 11, color: '#374151' }}>{s.label}</span>
                            <span style={{ fontSize: 11, color: '#6b7280' }}>
                              {s.value} {emailFunnel.sent > 0 ? `(${Math.round(s.value / emailFunnel.sent * 100)}%)` : ''}
                            </span>
                          </div>
                          <div style={{ background: '#f9fafb', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                            <div style={{ background: s.color, height: '100%', width: `${(s.value / max) * 100}%`, borderRadius: 4, transition: 'width 0.3s' }} />
                          </div>
                        </div>
                      ))}
                      {emailFunnel.bounced > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                          <span style={{ fontSize: 11, color: '#dc3545' }}>Bounced</span>
                          <span style={{ fontSize: 11, color: '#dc3545' }}>{emailFunnel.bounced}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div style={S.card}>
              <div style={S.cardHeader}><h2 style={S.h2}>Cart Recovery</h2></div>
              <div style={{ padding: '16px 18px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: '#C9964A' }}>{recoveryStats.total_carts}</div>
                    <div style={{ ...S.label, marginTop: 4 }}>Abandoned</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: '#2D6A4F' }}>{recoveryStats.recovered}</div>
                    <div style={{ ...S.label, marginTop: 4 }}>Recovered</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: '#8B5CF6' }}>
                      {'\u20AC'}{recoveryStats.revenue.toFixed(0)}
                    </div>
                    <div style={{ ...S.label, marginTop: 4 }}>Revenue</div>
                  </div>
                </div>
                {recoveryStats.total_carts > 0 && (
                  <div style={{ marginTop: 12, textAlign: 'center' }}>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      Recovery rate: {Math.round(recoveryStats.recovered / recoveryStats.total_carts * 100)}%
                    </span>
                    {recoveryStats.by_sillages != null && recoveryStats.by_sillages > 0 && (
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                        By Sillages: {recoveryStats.by_sillages} ({'\u20AC'}{(recoveryStats.by_sillages_revenue ?? 0).toFixed(0)}) | Organic: {recoveryStats.organic ?? 0} ({'\u20AC'}{(recoveryStats.organic_revenue ?? 0).toFixed(0)})
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Email Log Table */}
          <div style={S.card}>
            <div style={S.cardHeader}><h2 style={S.h2}>Email Log ({emailLogs.length})</h2></div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    {['Time', 'Store', 'Channel', 'Status', 'Delivered', 'Opened', 'Clicked', 'Error'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 12px', ...S.label }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {emailLogs.map((log, i) => (
                    <tr key={`${log.id ?? i}`} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: '#6b7280' }}>{shortTime(log.sent_at)}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ fontSize: 12, color: '#374151' }}>{log.shop_name ?? '—'}</div>
                        <div style={{ fontSize: 10, color: '#9ca3af' }}>{log.account_email}</div>
                      </td>
                      <td style={{ padding: '8px 12px' }}><span style={channelBadge(log.channel)}>{log.channel}</span></td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={statusBadge(log.bounced_at ? 'failed' : log.status)}>{log.bounced_at ? 'bounced' : log.status}</span>
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11 }}>
                        {log.delivered_at ? <span style={{ color: '#2D6A4F' }}>{shortTime(log.delivered_at)}</span> : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11 }}>
                        {log.opened_at ? <span style={{ color: '#C9964A' }}>{shortTime(log.opened_at)}</span> : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11 }}>
                        {log.clicked_at ? <span style={{ color: '#8B5CF6' }}>{shortTime(log.clicked_at)}</span> : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: '#dc3545', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {log.error_message ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
