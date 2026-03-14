import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import api from '../lib/api';

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
  pending_actions: number;
}

interface AdminAlert {
  id: string;
  alert_type: string;
  account_id: string | null;
  message: string;
  sent_at: string;
}

interface StatusData {
  stores: Store[];
  recent_alerts: AdminAlert[];
  last_audit: { ran_at: string; alerts_count: number; duration_ms: number } | null;
  server_time: string;
}

function TokenBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    healthy: { bg: '#d4edda', text: '#155724' },
    failing: { bg: '#fff3cd', text: '#856404' },
    invalid: { bg: '#f8d7da', text: '#721c24' },
    no_connection: { bg: '#e2e3e5', text: '#383d41' },
  };
  const c = colors[status] ?? colors.no_connection;

  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      textTransform: 'uppercase',
      backgroundColor: c.bg,
      color: c.text,
    }}>
      {status}
    </span>
  );
}

function BriefBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: '#999', fontSize: 12 }}>—</span>;
  const colors: Record<string, { bg: string; text: string }> = {
    ready: { bg: '#d4edda', text: '#155724' },
    generating: { bg: '#cce5ff', text: '#004085' },
    failed: { bg: '#f8d7da', text: '#721c24' },
  };
  const c = colors[status] ?? { bg: '#e2e3e5', text: '#383d41' };

  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      textTransform: 'uppercase',
      backgroundColor: c.bg,
      color: c.text,
    }}>
      {status}
    </span>
  );
}

function timeAgo(date: string | null): string {
  if (!date) return '—';
  try {
    return formatDistanceToNow(parseISO(date), { addSuffix: true, locale: es });
  } catch {
    return date;
  }
}

export default function AdminStatus() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get('/admin/status');
      setData(res.data);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 60000); // Auto-refresh every 60s
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#1a1a2e', color: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#1a1a2e', color: '#eee', padding: 40 }}>
        <h1 style={{ color: '#ff6b6b' }}>Error: {error}</h1>
        <p style={{ color: '#999' }}>Make sure you're logged in as admin.</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={{ minHeight: '100vh', background: '#1a1a2e', color: '#e0e0e0', padding: '24px 32px', fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: 0 }}>Sillages Admin Status</h1>
          <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            Server: {data.server_time.slice(0, 19)} | Refreshed: {lastRefresh.toLocaleTimeString()} | Auto-refresh: 60s
          </p>
        </div>
        <button
          onClick={fetchStatus}
          style={{
            background: '#2d2d44',
            color: '#ccc',
            border: '1px solid #444',
            padding: '8px 16px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Refresh Now
        </button>
      </div>

      {/* Last Audit */}
      {data.last_audit && (
        <div style={{ background: '#2d2d44', borderRadius: 8, padding: '12px 16px', marginBottom: 24, fontSize: 13 }}>
          Last audit: {timeAgo(data.last_audit.ran_at)} | {data.last_audit.alerts_count} alerts | {data.last_audit.duration_ms}ms
        </div>
      )}

      {/* Stores Table */}
      <h2 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Stores ({data.stores.length})</h2>
      <div style={{ overflowX: 'auto', marginBottom: 32 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #444' }}>
              {['Store', 'Email', 'Token', 'Last Brief', 'Status', 'Generated', 'Last Action', 'Pending'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: '#999', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.stores.map(store => (
              <tr key={store.account_id} style={{ borderBottom: '1px solid #333' }}>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ fontWeight: 600, color: '#fff' }}>{store.shop_name ?? '—'}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>{store.shop_domain ?? 'no connection'}</div>
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: '#aaa' }}>{store.email}</td>
                <td style={{ padding: '10px 12px' }}>
                  <TokenBadge status={store.token_status} />
                  {store.token_failing_since && (
                    <div style={{ fontSize: 10, color: '#ff6b6b', marginTop: 2 }}>since {timeAgo(store.token_failing_since)}</div>
                  )}
                </td>
                <td style={{ padding: '10px 12px', color: '#ccc' }}>{store.last_brief_date ?? '—'}</td>
                <td style={{ padding: '10px 12px' }}>
                  <BriefBadge status={store.last_brief_status} />
                  {store.last_brief_error && (
                    <div style={{ fontSize: 10, color: '#ff6b6b', marginTop: 2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {store.last_brief_error}
                    </div>
                  )}
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: '#aaa' }}>{timeAgo(store.last_brief_generated_at)}</td>
                <td style={{ padding: '10px 12px', fontSize: 12 }}>
                  {store.last_action_title ? (
                    <div>
                      <span style={{ color: '#ccc' }}>{store.last_action_title}</span>
                      <div style={{ fontSize: 10, color: '#888' }}>{timeAgo(store.last_action_executed)}</div>
                    </div>
                  ) : (
                    <span style={{ color: '#666' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                  {store.pending_actions > 0 ? (
                    <span style={{ background: '#C9964A', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>
                      {store.pending_actions}
                    </span>
                  ) : (
                    <span style={{ color: '#666' }}>0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent Alerts */}
      <h2 style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Recent Alerts ({data.recent_alerts.length})</h2>
      {data.recent_alerts.length === 0 ? (
        <div style={{ background: '#2d2d44', borderRadius: 8, padding: '16px 20px', color: '#4caf50', fontSize: 14 }}>
          All clear — no recent alerts
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.recent_alerts.map(alert => (
            <div
              key={alert.id}
              style={{
                background: '#2d2d44',
                borderRadius: 8,
                padding: '12px 16px',
                borderLeft: `3px solid ${alert.alert_type.includes('critical') ? '#ff6b6b' : '#C9964A'}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: alert.alert_type.includes('critical') ? '#ff6b6b' : '#C9964A',
                }}>
                  {alert.alert_type}
                </span>
                <span style={{ fontSize: 11, color: '#888' }}>{timeAgo(alert.sent_at)}</span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#ccc', lineHeight: 1.4 }}>{alert.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
