import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

interface AgentData {
  name: string;
  status: 'ok' | 'warning' | 'critical' | 'offline';
  lastCheck: string | null;
  data: Record<string, unknown>;
}

interface TowerResponse {
  timestamp: string;
  agents: AgentData[];
}

// ── Status helpers ─────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { dot: string; label: string; color: string; bg: string }> = {
  ok:       { dot: '#2D6A4F', label: 'NOMINAL',  color: '#2D6A4F', bg: 'rgba(45,106,79,0.12)' },
  warning:  { dot: '#D4A017', label: 'WARNING',  color: '#D4A017', bg: 'rgba(212,160,23,0.12)' },
  critical: { dot: '#DC2626', label: 'CRITICAL', color: '#DC2626', bg: 'rgba(220,38,38,0.12)' },
  offline:  { dot: '#6B7280', label: 'OFFLINE',  color: '#6B7280', bg: 'rgba(107,114,128,0.12)' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: cfg.bg, color: cfg.color,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
      padding: '4px 10px', borderRadius: 6,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ── Agent Cards ────────────────────────────────────────────────────────────

function HealthCard({ agent }: { agent: AgentData }) {
  const d = agent.data as {
    tokens?: { active: number; invalid: number };
    emailsToday?: number;
    emailsFailed24h?: number;
    lastSync?: string;
    stuckLocks?: number;
    issues?: string[];
    connections?: Array<{ shop: string; name: string; tokenStatus: string; syncStatus: string; lastSynced: string | null }>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <Metric label="Tokens" value={`${d.tokens?.active ?? 0}/${(d.tokens?.active ?? 0) + (d.tokens?.invalid ?? 0)}`} />
        <Metric label="Emails today" value={String(d.emailsToday ?? 0)} />
        <Metric label="Failed 24h" value={String(d.emailsFailed24h ?? 0)} warn={!!d.emailsFailed24h} />
        <Metric label="Last sync" value={d.lastSync ?? 'never'} />
      </div>

      {/* Issues */}
      {d.issues && d.issues.length > 0 && (
        <div style={{ background: 'rgba(220,38,38,0.08)', borderRadius: 8, padding: '10px 14px' }}>
          {d.issues.map((issue, i) => (
            <p key={i} style={{ margin: 0, fontSize: 12, color: '#F87171', lineHeight: 1.6 }}>{issue}</p>
          ))}
        </div>
      )}

      {/* Connections */}
      {d.connections && d.connections.length > 0 && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#6B7280', marginBottom: 8 }}>CONNECTIONS</p>
          {d.connections.map((c, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div>
                <span style={{ fontSize: 13, color: '#E5E7EB' }}>{c.name}</span>
                <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 8 }}>{c.shop}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <MiniTag label={c.tokenStatus} ok={c.tokenStatus === 'active'} />
                <MiniTag label={c.syncStatus} ok={c.syncStatus === 'active'} />
                <span style={{ fontSize: 10, color: '#6B7280' }}>{timeAgo(c.lastSynced)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivationCard({ agent }: { agent: AgentData }) {
  const d = agent.data as {
    funnel?: { total: number; installed: number; connected: number; synced: number; active: number };
    newToday?: number;
    merchants?: Array<{
      email: string; name: string; shop: string | null; shopName: string | null;
      plan: string; isBeta: boolean; stage: string; action: string | null;
      sendEnabled: boolean; createdAt: string;
    }>;
    stuck?: Array<{ email: string; shop: string | null; stage: string; action: string | null }>;
    pendingActions?: number;
  };

  const f = d.funnel ?? { total: 0, installed: 0, connected: 0, synced: 0, active: 0 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Funnel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        <Metric label="Total" value={String(f.total)} />
        <Metric label="Installed" value={String(f.installed)} warn={f.installed > 0} />
        <Metric label="Connected" value={String(f.connected)} />
        <Metric label="Synced" value={String(f.synced)} warn={f.synced > 0} />
        <Metric label="Active" value={String(f.active)} />
      </div>

      {/* Funnel bar */}
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
        {f.active > 0 && <div style={{ flex: f.active, background: '#2D6A4F' }} />}
        {f.synced > 0 && <div style={{ flex: f.synced, background: '#D4A017' }} />}
        {f.connected > 0 && <div style={{ flex: f.connected, background: '#3B82F6' }} />}
        {f.installed > 0 && <div style={{ flex: f.installed, background: '#6B7280' }} />}
      </div>

      {/* New today */}
      {(d.newToday ?? 0) > 0 && (
        <p style={{ margin: 0, fontSize: 13, color: '#2D6A4F' }}>+{d.newToday} new merchant(s) today</p>
      )}

      {/* Stuck merchants */}
      {d.stuck && d.stuck.length > 0 && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#D4A017', marginBottom: 8 }}>STUCK MERCHANTS</p>
          {d.stuck.map((m, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#E5E7EB' }}>{m.email}</span>
                <MiniTag label={m.stage} ok={false} />
              </div>
              {m.action && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9CA3AF' }}>{m.action}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Merchant list */}
      {d.merchants && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#6B7280', marginBottom: 8 }}>ALL MERCHANTS</p>
          {d.merchants.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div>
                <span style={{ fontSize: 13, color: '#E5E7EB' }}>{m.name ?? m.email}</span>
                {m.shopName && <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 8 }}>{m.shopName}</span>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <MiniTag label={m.plan} ok={m.plan !== 'none'} />
                <MiniTag label={m.stage} ok={m.stage === 'active'} />
                {m.isBeta && <MiniTag label="BETA" ok />}
                {!m.sendEnabled && <MiniTag label="MUTED" ok={false} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceholderCard({ agent }: { agent: AgentData }) {
  const msg = (agent.data as { message?: string }).message ?? 'Coming soon';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
      <p style={{ fontSize: 13, color: '#6B7280', fontStyle: 'italic' }}>{msg}</p>
    </div>
  );
}

// ── Primitives ──────────────────────────────────────────────────────────────

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px' }}>
      <p style={{ margin: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: '#6B7280', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 600, color: warn ? '#D4A017' : '#E5E7EB', lineHeight: 1 }}>{value}</p>
    </div>
  );
}

function MiniTag({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      padding: '2px 6px', borderRadius: 4,
      background: ok ? 'rgba(45,106,79,0.15)' : 'rgba(212,160,23,0.15)',
      color: ok ? '#2D6A4F' : '#D4A017',
    }}>
      {label}
    </span>
  );
}

// ── Agent card renderers ───────────────────────────────────────────────────

const AGENT_RENDERERS: Record<string, (agent: AgentData) => React.ReactNode> = {
  'Production Health': (a) => <HealthCard agent={a} />,
  'Merchant Activation': (a) => <ActivationCard agent={a} />,
};

// ── Page ────────────────────────────────────────────────────────────────────

export default function Tower() {
  const [data, setData] = useState<TowerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const { data: res } = await api.get('/api/tower');
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0F1117',
      color: '#E5E7EB',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      padding: '32px 24px',
    }}>
      {/* Header */}
      <div style={{ maxWidth: 1400, margin: '0 auto', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', color: '#C9964A', textTransform: 'uppercase' }}>
              SILLAGES CONTROL TOWER
            </span>
            {data && (
              <span style={{ fontSize: 10, color: '#6B7280' }}>
                Updated {timeAgo(data.timestamp)}
              </span>
            )}
          </div>
          <a href="/dashboard" style={{ fontSize: 12, color: '#6B7280', textDecoration: 'none' }}>
            Back to Dashboard
          </a>
        </div>
        <div style={{ height: 1, background: 'rgba(201,150,74,0.15)', marginTop: 16 }} />
      </div>

      {/* Error / Loading */}
      {loading && (
        <div style={{ maxWidth: 1400, margin: '0 auto', textAlign: 'center', padding: 80 }}>
          <p style={{ color: '#6B7280' }}>Loading tower data...</p>
        </div>
      )}

      {error && (
        <div style={{ maxWidth: 1400, margin: '0 auto', background: 'rgba(220,38,38,0.1)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <p style={{ margin: 0, color: '#F87171', fontSize: 14 }}>{error}</p>
        </div>
      )}

      {/* Agent Grid */}
      {data && (
        <div style={{
          maxWidth: 1400,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: 20,
        }}>
          {data.agents.map((agent, i) => {
            const renderer = AGENT_RENDERERS[agent.name];
            return (
              <div
                key={i}
                style={{
                  background: '#1A1D27',
                  borderRadius: 16,
                  border: '1px solid rgba(255,255,255,0.06)',
                  overflow: 'hidden',
                  gridColumn: (agent.name === 'Merchant Activation') ? 'span 2' : undefined,
                }}
              >
                {/* Card header */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '16px 20px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: 8,
                      background: 'rgba(201,150,74,0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, color: '#C9964A',
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#E5E7EB' }}>{agent.name}</span>
                  </div>
                  <StatusBadge status={agent.status} />
                </div>

                {/* Card body */}
                <div style={{ padding: '16px 20px' }}>
                  {renderer ? renderer(agent) : <PlaceholderCard agent={agent} />}
                </div>

                {/* Card footer */}
                <div style={{
                  padding: '8px 20px',
                  borderTop: '1px solid rgba(255,255,255,0.04)',
                  display: 'flex', justifyContent: 'flex-end',
                }}>
                  <span style={{ fontSize: 10, color: '#4B5563' }}>
                    {agent.lastCheck ? `Last check: ${timeAgo(agent.lastCheck)}` : 'Not active'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
