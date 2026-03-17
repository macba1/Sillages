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
  comms_approval: string;
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
  pending_actions: number;
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

interface StatusData {
  stores: Store[];
  recent_alerts: AdminAlert[];
  last_audit: { ran_at: string; alerts_count: number; duration_ms: number } | null;
  recent_deliveries?: DeliveryLog[];
  pending_comms_count: number;
  server_time: string;
}

interface AdminAction {
  id: string;
  account_id: string;
  type: string;
  title: string;
  description: string;
  content: Record<string, unknown>;
  status: string;
  created_at: string;
  approved_at: string | null;
  executed_at: string | null;
  result: Record<string, unknown> | null;
  account_email: string | null;
  account_name: string | null;
  shop_name: string | null;
  shop_domain: string | null;
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
}

interface PendingComm {
  id: string;
  account_id: string;
  type: string;
  channel: string;
  content: Record<string, unknown>;
  status: string;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  account_email: string | null;
  account_name: string | null;
  shop_name: string | null;
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const S = {
  page: { minHeight: '100vh', background: '#0f0f1a', color: '#e0e0e0', padding: '20px 24px', fontFamily: "'DM Sans', 'SF Mono', monospace", fontSize: 13 } as const,
  card: { background: '#1a1a2e', borderRadius: 10, border: '1px solid #2a2a40', marginBottom: 16 } as const,
  cardHeader: { padding: '14px 18px', borderBottom: '1px solid #2a2a40', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as const,
  cardBody: { padding: '14px 18px' } as const,
  h2: { fontSize: 15, fontWeight: 700, color: '#fff', margin: 0 } as const,
  badge: (bg: string, text: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', background: bg, color: text }),
  btn: (bg: string) => ({ background: bg, color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }),
  tab: (active: boolean) => ({ background: active ? '#C9964A' : '#2a2a40', color: active ? '#000' : '#888', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }),
  muted: { color: '#666', fontSize: 12 } as const,
  label: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: '#666', marginBottom: 4 } as const,
};

function statusBadge(status: string) {
  const map: Record<string, [string, string]> = {
    pending: ['#C9964A', '#000'],
    completed: ['#2D6A4F', '#fff'],
    rejected: ['#721c24', '#fff'],
    failed: ['#dc3545', '#fff'],
    sent: ['#2D6A4F', '#fff'],
    healthy: ['#2D6A4F', '#fff'],
    invalid: ['#dc3545', '#fff'],
    failing: ['#C9964A', '#000'],
  };
  const [bg, text] = map[status] ?? ['#444', '#ccc'];
  return S.badge(bg, text);
}

function channelBadge(channel: string) {
  const map: Record<string, [string, string]> = {
    push: ['#004085', '#cce5ff'],
    email: ['#856404', '#fff3cd'],
    weekly_email: ['#155724', '#d4edda'],
    event_push: ['#3d0066', '#e6ccff'],
    daily_summary_push: ['#004085', '#cce5ff'],
  };
  const [bg, text] = map[channel] ?? ['#444', '#ccc'];
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

type Tab = 'overview' | 'actions' | 'comms' | 'activity' | 'emails';

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminStatus() {
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<StatusData | null>(null);
  const [actions, setActions] = useState<AdminAction[]>([]);
  const [pendingComms, setPendingComms] = useState<PendingComm[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [emailFunnel, setEmailFunnel] = useState<EmailFunnel>({ sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 });
  const [recoveryStats, setRecoveryStats] = useState<RecoveryStats>({ total_carts: 0, recovered: 0, revenue: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, actionsRes, commsRes, emailRes] = await Promise.all([
        api.get('/api/admin/status'),
        api.get('/api/admin/actions'),
        api.get('/api/admin/pending-comms').catch(() => ({ data: { comms: [] } })),
        api.get('/api/admin/email-tracking').catch(() => ({ data: { logs: [], funnel: { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 }, recovery: { total_carts: 0, recovered: 0, revenue: 0 } } })),
      ]);
      setData(statusRes.data);
      setActions(actionsRes.data.actions ?? []);
      setPendingComms(commsRes.data.comms ?? []);
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

  async function handleApprove(actionId: string) {
    if (!confirm('Approve and execute this action?')) return;
    setActionLoading(actionId);
    try {
      await api.put(`/api/admin/actions/${actionId}/approve`);
      await fetchAll();
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(actionId: string) {
    if (!confirm('Reject this action?')) return;
    setActionLoading(actionId);
    try {
      await api.put(`/api/admin/actions/${actionId}/reject`);
      await fetchAll();
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCommApprove(commId: string) {
    if (!confirm('Approve and SEND this communication?')) return;
    setActionLoading(commId);
    try {
      await api.put(`/api/admin/pending-comms/${commId}/approve`);
      await fetchAll();
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCommReject(commId: string) {
    if (!confirm('Reject this communication?')) return;
    setActionLoading(commId);
    try {
      await api.put(`/api/admin/pending-comms/${commId}/reject`);
      await fetchAll();
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function toggleCommsApproval(accountId: string, current: string) {
    const next = current === 'auto' ? 'manual' : 'auto';
    if (!confirm(`Set comms_approval to "${next}" for this account?`)) return;
    try {
      await api.put(`/api/admin/accounts/${accountId}/comms-approval`, { comms_approval: next });
      await fetchAll();
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (loading) return <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p>Loading...</p></div>;
  if (error) return <div style={S.page}><h1 style={{ color: '#ff6b6b' }}>Error: {error}</h1></div>;
  if (!data) return null;

  const pendingActions = actions.filter(a => a.status === 'pending');
  const completedActions = actions.filter(a => a.status === 'completed');
  const rejectedActions = actions.filter(a => a.status === 'rejected');
  const failedActions = actions.filter(a => a.status === 'failed');
  const pendingCommsList = pendingComms.filter(c => c.status === 'pending');

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>Sillages Control Panel</h1>
          <p style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
            Server: {data.server_time.slice(11, 19)} UTC | Refresh: {lastRefresh.toLocaleTimeString()} | Auto: 30s
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchAll} style={S.btn('#2a2a40')}>Refresh</button>
        </div>
      </div>

      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Pending Actions', value: pendingActions.length, color: '#C9964A' },
          { label: 'Pending Comms', value: pendingCommsList.length, color: pendingCommsList.length > 0 ? '#ff6b6b' : '#2D6A4F' },
          { label: 'Completed', value: completedActions.length, color: '#2D6A4F' },
          { label: 'Rejected', value: rejectedActions.length, color: '#721c24' },
          { label: 'Failed', value: failedActions.length, color: '#dc3545' },
          { label: 'Stores', value: data.stores.length, color: '#004085' },
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
          ['overview', 'Overview'],
          ['actions', `Pending Actions (${pendingActions.length})`],
          ['comms', `Pending Comms (${pendingCommsList.length})`],
          ['activity', 'Activity Log'],
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
            <div style={S.cardHeader}><h2 style={S.h2}>Stores</h2></div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a40' }}>
                    {['Store', 'Email', 'Plan', 'Comms', 'Token', 'Brief', 'Push', 'Weekly', 'Pending'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 12px', ...S.label }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.stores.map(store => (
                    <tr key={store.account_id} style={{ borderBottom: '1px solid #1f1f35' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{store.shop_name ?? '—'}</div>
                        <div style={{ fontSize: 10, color: '#555' }}>{store.shop_domain ?? 'no connection'}</div>
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: '#888' }}>{store.email}</td>
                      <td style={{ padding: '8px 12px' }}><span style={statusBadge(store.subscription)}>{store.subscription}</span></td>
                      <td style={{ padding: '8px 12px' }}>
                        <button
                          onClick={() => toggleCommsApproval(store.account_id, store.comms_approval)}
                          style={{ ...S.badge(store.comms_approval === 'auto' ? '#2D6A4F' : '#C9964A', store.comms_approval === 'auto' ? '#fff' : '#000'), cursor: 'pointer', border: 'none' }}
                        >
                          {store.comms_approval}
                        </button>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={statusBadge(store.token_status)}>{store.token_status}</span>
                        {store.token_failing_since && <div style={{ fontSize: 9, color: '#ff6b6b', marginTop: 2 }}>since {timeAgo(store.token_failing_since)}</div>}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {store.last_brief_date ? (
                          <div>
                            <span style={{ color: '#ccc', fontSize: 12 }}>{store.last_brief_date}</span>
                            <div style={{ fontSize: 9, color: '#555' }}>{timeAgo(store.last_brief_generated_at)}</div>
                          </div>
                        ) : <span style={S.muted}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <span style={{ color: store.push_subscriptions > 0 ? '#4caf50' : '#555', fontWeight: 700 }}>{store.push_subscriptions}</span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {store.last_weekly_week ? (
                          <div>
                            <span style={statusBadge(store.last_weekly_status ?? 'unknown')}>{store.last_weekly_status}</span>
                            <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>{store.last_weekly_week}</div>
                          </div>
                        ) : <span style={S.muted}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        {store.pending_actions > 0 ? (
                          <span style={{ ...S.badge('#C9964A', '#000'), fontSize: 12, padding: '3px 10px', borderRadius: 10 }}>{store.pending_actions}</span>
                        ) : <span style={S.muted}>0</span>}
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
                    <div key={alert.id} style={{ padding: '8px 12px', borderLeft: `3px solid ${alert.alert_type.includes('critical') ? '#dc3545' : '#C9964A'}`, background: '#12122a', borderRadius: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: alert.alert_type.includes('critical') ? '#dc3545' : '#C9964A', textTransform: 'uppercase' }}>{alert.alert_type}</span>
                        <span style={{ fontSize: 10, color: '#555' }}>{timeAgo(alert.sent_at)}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 12, color: '#aaa', lineHeight: 1.4 }}>{alert.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── TAB: Pending Approval ─────────────────────────────────────────────── */}
      {tab === 'actions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pendingActions.length === 0 ? (
            <div style={{ ...S.card, ...S.cardBody }}>
              <p style={{ color: '#2D6A4F' }}>No pending actions</p>
            </div>
          ) : (
            pendingActions.map(action => (
              <ActionCard
                key={action.id}
                action={action}
                loading={actionLoading === action.id}
                onApprove={() => handleApprove(action.id)}
                onReject={() => handleReject(action.id)}
              />
            ))
          )}
        </div>
      )}

      {/* ── TAB: Pending Comms ───────────────────────────────────────────────── */}
      {tab === 'comms' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pendingCommsList.length === 0 ? (
            <div style={{ ...S.card, ...S.cardBody }}>
              <p style={{ color: '#2D6A4F' }}>No pending communications</p>
            </div>
          ) : (
            pendingCommsList.map(comm => (
              <div key={comm.id} style={S.card}>
                <div style={S.cardHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                    <span style={channelBadge(comm.channel)}>{comm.channel}</span>
                    <span style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>
                      {comm.shop_name ?? comm.account_email ?? comm.account_id.slice(0, 8)}
                    </span>
                    <span style={{ color: '#555', fontSize: 11 }}>{comm.account_email}</span>
                  </div>
                  <span style={{ fontSize: 10, color: '#555' }}>{shortTime(comm.created_at)}</span>
                </div>
                <div style={S.cardBody}>
                  {/* Push content preview */}
                  {comm.type === 'push' && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={S.label}>Push Notification</div>
                      <div style={{ background: '#12122a', borderRadius: 6, padding: 12, border: '1px solid #2a2a40' }}>
                        <div style={{ fontWeight: 600, color: '#fff', fontSize: 13, marginBottom: 4 }}>
                          {(comm.content as { title?: string }).title ?? 'Push'}
                        </div>
                        <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>
                          {(comm.content as { body?: string }).body ?? ''}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Weekly email preview */}
                  {comm.type === 'weekly_email' && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={S.label}>Weekly Email</div>
                      <p style={{ fontSize: 12, color: '#ccc' }}>
                        Brief ID: {(comm.content as { weekly_brief_id?: string }).weekly_brief_id ?? '—'}
                      </p>
                    </div>
                  )}

                  {/* Raw JSON */}
                  <details style={{ marginBottom: 12 }}>
                    <summary style={{ ...S.label, cursor: 'pointer', userSelect: 'none' }}>Raw Content</summary>
                    <pre style={{ background: '#12122a', borderRadius: 6, padding: 12, fontSize: 10, color: '#666', overflow: 'auto', maxHeight: 200, border: '1px solid #2a2a40', marginTop: 6 }}>
                      {JSON.stringify(comm.content, null, 2)}
                    </pre>
                  </details>

                  {/* Approve / Reject */}
                  <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid #2a2a40' }}>
                    <button
                      onClick={() => handleCommApprove(comm.id)}
                      disabled={actionLoading === comm.id}
                      style={{ ...S.btn('#2D6A4F'), opacity: actionLoading === comm.id ? 0.5 : 1 }}
                    >
                      {actionLoading === comm.id ? '...' : 'Approve & Send'}
                    </button>
                    <button
                      onClick={() => handleCommReject(comm.id)}
                      disabled={actionLoading === comm.id}
                      style={{ ...S.btn('#721c24'), opacity: actionLoading === comm.id ? 0.5 : 1 }}
                    >
                      {actionLoading === comm.id ? '...' : 'Reject'}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Show recent approved/rejected comms */}
          {pendingComms.filter(c => c.status !== 'pending').length > 0 && (
            <div style={S.card}>
              <div style={S.cardHeader}><h2 style={S.h2}>Recent Comms History</h2></div>
              <div style={S.cardBody}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {pendingComms.filter(c => c.status !== 'pending').slice(0, 20).map(c => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #1f1f35' }}>
                      <span style={statusBadge(c.status)}>{c.status}</span>
                      <span style={channelBadge(c.channel)}>{c.channel}</span>
                      <span style={{ color: '#ccc', fontSize: 12, flex: 1 }}>{c.shop_name ?? c.account_email}</span>
                      <span style={{ fontSize: 10, color: '#555' }}>{shortTime(c.approved_at ?? c.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Activity Log ─────────────────────────────────────────────────── */}
      {tab === 'activity' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Completed */}
          <div style={S.card}>
            <div style={S.cardHeader}><h2 style={S.h2}>Completed ({completedActions.length})</h2></div>
            <div style={S.cardBody}>
              {completedActions.length === 0 ? (
                <p style={S.muted}>No completed actions</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {completedActions.map(a => (
                    <ActivityRow key={a.id} action={a} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Rejected */}
          <div style={S.card}>
            <div style={S.cardHeader}><h2 style={S.h2}>Rejected ({rejectedActions.length})</h2></div>
            <div style={S.cardBody}>
              {rejectedActions.length === 0 ? (
                <p style={S.muted}>No rejected actions</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rejectedActions.map(a => (
                    <ActivityRow key={a.id} action={a} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Failed */}
          <div style={S.card}>
            <div style={S.cardHeader}><h2 style={S.h2}>Failed ({failedActions.length})</h2></div>
            <div style={S.cardBody}>
              {failedActions.length === 0 ? (
                <p style={S.muted}>No failed actions</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {failedActions.map(a => (
                    <ActivityRow key={a.id} action={a} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Email Tracking ───────────────────────────────────────────────── */}
      {tab === 'emails' && (
        <>
          {/* Funnel + Recovery stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Email Funnel */}
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
                            <span style={{ fontSize: 11, color: '#ccc' }}>{s.label}</span>
                            <span style={{ fontSize: 11, color: '#888' }}>
                              {s.value} {emailFunnel.sent > 0 ? `(${Math.round(s.value / emailFunnel.sent * 100)}%)` : ''}
                            </span>
                          </div>
                          <div style={{ background: '#12122a', borderRadius: 4, height: 8, overflow: 'hidden' }}>
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

            {/* Recovery Stats */}
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
                    <span style={{ fontSize: 12, color: '#888' }}>
                      Recovery rate: {Math.round(recoveryStats.recovered / recoveryStats.total_carts * 100)}%
                    </span>
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
                  <tr style={{ borderBottom: '1px solid #2a2a40' }}>
                    {['Time', 'Store', 'Channel', 'Status', 'Delivered', 'Opened', 'Clicked', 'Error'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 12px', ...S.label }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {emailLogs.map((log, i) => (
                    <tr key={`${log.id ?? i}`} style={{ borderBottom: '1px solid #1f1f35' }}>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: '#888' }}>{shortTime(log.sent_at)}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ fontSize: 12, color: '#ccc' }}>{log.shop_name ?? '—'}</div>
                        <div style={{ fontSize: 10, color: '#555' }}>{log.account_email}</div>
                      </td>
                      <td style={{ padding: '8px 12px' }}><span style={channelBadge(log.channel)}>{log.channel}</span></td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={statusBadge(log.bounced_at ? 'failed' : log.status)}>{log.bounced_at ? 'bounced' : log.status}</span>
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11 }}>
                        {log.delivered_at ? <span style={{ color: '#2D6A4F' }}>{shortTime(log.delivered_at)}</span> : <span style={{ color: '#444' }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11 }}>
                        {log.opened_at ? <span style={{ color: '#C9964A' }}>{shortTime(log.opened_at)}</span> : <span style={{ color: '#444' }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11 }}>
                        {log.clicked_at ? <span style={{ color: '#8B5CF6' }}>{shortTime(log.clicked_at)}</span> : <span style={{ color: '#444' }}>—</span>}
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

// ── Action Card Component ─────────────────────────────────────────────────────

function ActionCard({ action, loading, onApprove, onReject }: {
  action: AdminAction;
  loading: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const content = action.content ?? {};
  const isEmail = ['cart_recovery', 'welcome_email', 'reactivation_email'].includes(action.type);
  const recipients = content.recipients as Array<{ email: string; name: string }> | undefined;

  return (
    <div style={S.card}>
      <div style={{ ...S.cardHeader, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <span style={statusBadge(action.type === 'cart_recovery' ? 'failing' : action.type === 'welcome_email' ? 'healthy' : 'pending')}>
            {action.type.replace(/_/g, ' ')}
          </span>
          <span style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>{action.title}</span>
          <span style={{ color: '#555', fontSize: 11 }}>
            {action.shop_name ?? action.shop_domain ?? '—'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#555' }}>{shortTime(action.created_at)}</span>
          <span style={{ color: '#555', fontSize: 14 }}>{expanded ? '▾' : '▸'}</span>
        </div>
      </div>

      {expanded && (
        <div style={S.cardBody}>
          {/* Description */}
          <div style={{ marginBottom: 12 }}>
            <div style={S.label}>Description</div>
            <p style={{ margin: 0, fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{action.description}</p>
          </div>

          {/* Recipient info */}
          {isEmail && (
            <div style={{ marginBottom: 12 }}>
              <div style={S.label}>Recipient</div>
              {Boolean(content.customer_email) ? (
                <p style={{ margin: 0, fontSize: 13, color: '#ccc' }}>
                  {String(content.customer_name ?? '')} &lt;{String(content.customer_email)}&gt;
                </p>
              ) : recipients ? (
                <div>
                  {recipients.map((r, i) => (
                    <p key={i} style={{ margin: 0, fontSize: 12, color: '#ccc' }}>{r.name} &lt;{r.email}&gt;</p>
                  ))}
                </div>
              ) : <p style={S.muted}>No recipient specified</p>}
            </div>
          )}

          {/* Copy / Content preview */}
          {Boolean(content.copy) && (
            <div style={{ marginBottom: 12 }}>
              <div style={S.label}>Copy</div>
              <div style={{ background: '#12122a', borderRadius: 6, padding: 12, fontSize: 12, color: '#aaa', lineHeight: 1.6, whiteSpace: 'pre-wrap', border: '1px solid #2a2a40' }}>
                {String(content.copy)}
              </div>
            </div>
          )}

          {/* Products (for cart recovery) */}
          {Boolean(content.products) && (
            <div style={{ marginBottom: 12 }}>
              <div style={S.label}>Products</div>
              {(content.products as Array<{ title: string; quantity: number; price: number }>).map((p, i) => (
                <div key={i} style={{ fontSize: 12, color: '#ccc' }}>
                  {p.title} x{p.quantity} — {p.price}
                </div>
              ))}
              {Boolean(content.total_price) && (
                <div style={{ fontSize: 12, color: '#C9964A', fontWeight: 600, marginTop: 4 }}>
                  Total: {String(content.total_price)} {String(content.currency ?? '')}
                </div>
              )}
            </div>
          )}

          {/* Full content JSON (collapsible) */}
          <details style={{ marginBottom: 12 }}>
            <summary style={{ ...S.label, cursor: 'pointer', userSelect: 'none' }}>Raw Content JSON</summary>
            <pre style={{ background: '#12122a', borderRadius: 6, padding: 12, fontSize: 10, color: '#666', overflow: 'auto', maxHeight: 200, border: '1px solid #2a2a40', marginTop: 6 }}>
              {JSON.stringify(content, null, 2)}
            </pre>
          </details>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid #2a2a40' }}>
            <button
              onClick={onApprove}
              disabled={loading}
              style={{ ...S.btn('#2D6A4F'), opacity: loading ? 0.5 : 1 }}
            >
              {loading ? '...' : 'Approve'}
            </button>
            <button
              onClick={onReject}
              disabled={loading}
              style={{ ...S.btn('#721c24'), opacity: loading ? 0.5 : 1 }}
            >
              {loading ? '...' : 'Reject'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Activity Row Component ────────────────────────────────────────────────────

function ActivityRow({ action }: { action: AdminAction }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ background: '#12122a', borderRadius: 6, border: '1px solid #1f1f35' }}>
      <div
        style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={statusBadge(action.status)}>{action.status}</span>
        <span style={statusBadge(action.type)}>{action.type.replace(/_/g, ' ')}</span>
        <span style={{ color: '#ccc', fontSize: 12, flex: 1 }}>{action.title}</span>
        <span style={{ color: '#555', fontSize: 11 }}>{action.shop_name ?? '—'}</span>
        <span style={{ color: '#555', fontSize: 10 }}>
          {shortTime(action.executed_at ?? action.created_at)}
        </span>
        <span style={{ color: '#555', fontSize: 14 }}>{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid #1f1f35' }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{action.description}</div>

          {Boolean(action.content?.copy) && (
            <div style={{ marginBottom: 8 }}>
              <div style={S.label}>Copy</div>
              <div style={{ background: '#0f0f1a', borderRadius: 4, padding: 8, fontSize: 11, color: '#888', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {String(action.content.copy)}
              </div>
            </div>
          )}

          {action.result && (
            <div>
              <div style={S.label}>Result</div>
              <pre style={{ background: '#0f0f1a', borderRadius: 4, padding: 8, fontSize: 10, color: '#666', overflow: 'auto', maxHeight: 150 }}>
                {JSON.stringify(action.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
