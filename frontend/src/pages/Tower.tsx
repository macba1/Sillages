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
  ok:       { dot: '#2D6A4F', label: 'NOMINAL',  color: '#2D6A4F', bg: 'rgba(45,106,79,0.08)' },
  warning:  { dot: '#B45309', label: 'WARNING',  color: '#B45309', bg: 'rgba(180,83,9,0.08)' },
  critical: { dot: '#DC2626', label: 'CRITICAL', color: '#DC2626', bg: 'rgba(220,38,38,0.08)' },
  offline:  { dot: '#9CA3AF', label: 'OFFLINE',  color: '#9CA3AF', bg: 'rgba(156,163,175,0.08)' },
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <Metric label="Tokens" value={`${d.tokens?.active ?? 0}/${(d.tokens?.active ?? 0) + (d.tokens?.invalid ?? 0)}`} />
        <Metric label="Emails today" value={String(d.emailsToday ?? 0)} />
        <Metric label="Failed 24h" value={String(d.emailsFailed24h ?? 0)} warn={!!d.emailsFailed24h} />
        <Metric label="Last sync" value={d.lastSync ?? 'never'} />
      </div>

      {d.issues && d.issues.length > 0 && (
        <div style={{ background: 'rgba(220,38,38,0.06)', borderRadius: 8, padding: '10px 14px', border: '1px solid rgba(220,38,38,0.12)' }}>
          {d.issues.map((issue, i) => (
            <p key={i} style={{ margin: 0, fontSize: 12, color: '#DC2626', lineHeight: 1.6 }}>{issue}</p>
          ))}
        </div>
      )}

      {d.connections && d.connections.length > 0 && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 8 }}>CONNECTIONS</p>
          {d.connections.map((c, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F3F4F6' }}>
              <div>
                <span style={{ fontSize: 13, color: '#1F2937' }}>{c.name}</span>
                <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 8 }}>{c.shop}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <MiniTag label={c.tokenStatus} ok={c.tokenStatus === 'active'} />
                <MiniTag label={c.syncStatus} ok={c.syncStatus === 'active'} />
                <span style={{ fontSize: 10, color: '#9CA3AF' }}>{timeAgo(c.lastSynced)}</span>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        <Metric label="Total" value={String(f.total)} />
        <Metric label="Installed" value={String(f.installed)} warn={f.installed > 0} />
        <Metric label="Connected" value={String(f.connected)} />
        <Metric label="Synced" value={String(f.synced)} warn={f.synced > 0} />
        <Metric label="Active" value={String(f.active)} />
      </div>

      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: '#F3F4F6' }}>
        {f.active > 0 && <div style={{ flex: f.active, background: '#2D6A4F' }} />}
        {f.synced > 0 && <div style={{ flex: f.synced, background: '#B45309' }} />}
        {f.connected > 0 && <div style={{ flex: f.connected, background: '#3B82F6' }} />}
        {f.installed > 0 && <div style={{ flex: f.installed, background: '#9CA3AF' }} />}
      </div>

      {(d.newToday ?? 0) > 0 && (
        <p style={{ margin: 0, fontSize: 13, color: '#2D6A4F' }}>+{d.newToday} new merchant(s) today</p>
      )}

      {d.stuck && d.stuck.length > 0 && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#B45309', marginBottom: 8 }}>STUCK MERCHANTS</p>
          {d.stuck.map((m, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #F3F4F6' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#1F2937' }}>{m.email}</span>
                <MiniTag label={m.stage} ok={false} />
              </div>
              {m.action && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#6B7280' }}>{m.action}</p>}
            </div>
          ))}
        </div>
      )}

      {d.merchants && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 8 }}>ALL MERCHANTS</p>
          {d.merchants.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F3F4F6' }}>
              <div>
                <span style={{ fontSize: 13, color: '#1F2937' }}>{m.name ?? m.email}</span>
                {m.shopName && <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 8 }}>{m.shopName}</span>}
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

function GrowthContentCard({ agent }: { agent: AgentData }) {
  const d = agent.data as {
    todayPost?: { id: string; platform: string; content: string; status: string; engagement: Record<string, number> } | null;
    weekCalendar?: Array<{ id: string; date: string; platform: string; status: string; preview: string }>;
    publishedThisWeek?: number;
    totalThisWeek?: number;
  };

  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);

  const PLATFORM_LABELS: Record<string, string> = { linkedin: 'LinkedIn', twitter: 'X / Twitter', reddit: 'Reddit' };
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  async function handlePublish(id: string) {
    setPublishing(true);
    try {
      await api.post(`/api/tower/content/${id}/publish`);
      window.location.reload();
    } catch { setPublishing(false); }
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <Metric label="Published this week" value={`${d.publishedThisWeek ?? 0}/${d.totalThisWeek ?? 0}`} />
        <Metric label="Today's platform" value={d.todayPost ? (PLATFORM_LABELS[d.todayPost.platform] ?? d.todayPost.platform) : 'None scheduled'} />
      </div>

      {d.todayPost && (
        <div style={{ background: '#F9FAFB', borderRadius: 10, border: '1px solid #E5E7EB', padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <MiniTag label={PLATFORM_LABELS[d.todayPost.platform] ?? d.todayPost.platform} ok />
            <MiniTag label={d.todayPost.status} ok={d.todayPost.status === 'published'} />
          </div>
          <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {d.todayPost.content}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => handleCopy(d.todayPost!.content)} style={towerBtnStyle}>
              {copied ? 'Copied!' : 'Copy text'}
            </button>
            {d.todayPost.status !== 'published' && (
              <button onClick={() => handlePublish(d.todayPost!.id)} disabled={publishing} style={{ ...towerBtnStyle, background: '#2D6A4F', color: '#fff' }}>
                {publishing ? 'Saving...' : 'Mark Published'}
              </button>
            )}
          </div>
        </div>
      )}

      {d.weekCalendar && d.weekCalendar.length > 0 && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 8 }}>WEEK CALENDAR</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {DAY_LABELS.map(d => (
              <div key={d} style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', textAlign: 'center', padding: 4 }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {d.weekCalendar.map(c => {
              const dayOfWeek = new Date(c.date + 'T12:00:00').getDay();
              const col = dayOfWeek === 0 ? 7 : dayOfWeek;
              return (
                <div key={c.id} style={{
                  gridColumn: col,
                  background: c.status === 'published' ? 'rgba(45,106,79,0.08)' : '#F9FAFB',
                  border: `1px solid ${c.status === 'published' ? 'rgba(45,106,79,0.2)' : '#E5E7EB'}`,
                  borderRadius: 6, padding: '6px 8px', textAlign: 'center',
                }}>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#374151' }}>{c.date.slice(8)}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 8, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase' }}>
                    {(PLATFORM_LABELS[c.platform] ?? c.platform).slice(0, 2)}
                  </p>
                  <span style={{
                    display: 'inline-block', width: 6, height: 6, borderRadius: '50%', marginTop: 2,
                    background: c.status === 'published' ? '#2D6A4F' : '#D1D5DB',
                  }} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AgencyOutreachCard({ agent }: { agent: AgentData }) {
  const d = agent.data as {
    total?: number; contacted?: number; responded?: number; demos?: number; converted?: number;
    agencies?: Array<{ id: string; name: string; url: string | null; contactName: string | null; contactLinkedin: string | null; status: string; lastContact: string | null; notes: string | null }>;
    suggestedMessage?: string;
  };

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addContact, setAddContact] = useState('');
  const [addLinkedin, setAddLinkedin] = useState('');
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const STATUS_ORDER = ['not_contacted', 'contacted', 'responded', 'demo', 'converted'];
  const STATUS_LABELS: Record<string, string> = {
    not_contacted: 'Not contacted', contacted: 'Contacted', responded: 'Responded', demo: 'Demo', converted: 'Converted',
  };

  async function handleAdd() {
    if (!addName.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/tower/agency', { name: addName, url: addUrl || undefined, contact_name: addContact || undefined, contact_linkedin: addLinkedin || undefined });
      window.location.reload();
    } catch { setSaving(false); }
  }

  async function handleAdvance(id: string, currentStatus: string) {
    const idx = STATUS_ORDER.indexOf(currentStatus);
    if (idx >= STATUS_ORDER.length - 1) return;
    setUpdatingId(id);
    try {
      await api.patch(`/api/tower/agency/${id}`, { status: STATUS_ORDER[idx + 1] });
      window.location.reload();
    } catch { setUpdatingId(null); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        <Metric label="Total" value={String(d.total ?? 0)} />
        <Metric label="Contacted" value={String(d.contacted ?? 0)} />
        <Metric label="Responded" value={String(d.responded ?? 0)} />
        <Metric label="Demos" value={String(d.demos ?? 0)} />
        <Metric label="Converted" value={String(d.converted ?? 0)} />
      </div>

      {d.agencies && d.agencies.length > 0 && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 8 }}>AGENCIES</p>
          {d.agencies.map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #F3F4F6' }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#1F2937' }}>{a.name}</span>
                {a.contactName && <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 8 }}>{a.contactName}</span>}
                {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#3B82F6', marginLeft: 8, textDecoration: 'none' }}>web</a>}
                {a.contactLinkedin && <a href={a.contactLinkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#3B82F6', marginLeft: 4, textDecoration: 'none' }}>in</a>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <MiniTag label={STATUS_LABELS[a.status] ?? a.status} ok={['responded', 'demo', 'converted'].includes(a.status)} />
                {a.status !== 'converted' && (
                  <button
                    onClick={() => handleAdvance(a.id, a.status)}
                    disabled={updatingId === a.id}
                    style={{ ...towerBtnStyle, fontSize: 10, padding: '2px 8px' }}
                  >
                    {updatingId === a.id ? '...' : 'Advance'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add agency form */}
      <div>
        {!showAdd ? (
          <button onClick={() => setShowAdd(true)} style={towerBtnStyle}>+ Add Agency</button>
        ) : (
          <div style={{ background: '#F9FAFB', borderRadius: 10, border: '1px solid #E5E7EB', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Agency name *" style={towerInputStyle} />
            <input value={addUrl} onChange={e => setAddUrl(e.target.value)} placeholder="Website URL" style={towerInputStyle} />
            <input value={addContact} onChange={e => setAddContact(e.target.value)} placeholder="Contact name" style={towerInputStyle} />
            <input value={addLinkedin} onChange={e => setAddLinkedin(e.target.value)} placeholder="LinkedIn URL" style={towerInputStyle} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleAdd} disabled={saving} style={{ ...towerBtnStyle, background: '#2D6A4F', color: '#fff' }}>
                {saving ? 'Saving...' : 'Add'}
              </button>
              <button onClick={() => setShowAdd(false)} style={towerBtnStyle}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {d.suggestedMessage && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 6 }}>SUGGESTED MESSAGE</p>
          <p style={{ margin: 0, fontSize: 12, color: '#6B7280', lineHeight: 1.6, fontStyle: 'italic' }}>{d.suggestedMessage}</p>
        </div>
      )}
    </div>
  );
}

function PlaceholderCard({ agent }: { agent: AgentData }) {
  const msg = (agent.data as { message?: string }).message ?? 'Coming soon';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
      <p style={{ fontSize: 13, color: '#9CA3AF', fontStyle: 'italic' }}>{msg}</p>
    </div>
  );
}

// ── Primitives ──────────────────────────────────────────────────────────────

const towerBtnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
  border: '1px solid #E5E7EB', background: '#fff', color: '#374151',
  cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
};

const towerInputStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 6, fontSize: 13,
  border: '1px solid #E5E7EB', background: '#fff', color: '#1F2937',
  fontFamily: "'DM Sans', sans-serif", outline: 'none', width: '100%', boxSizing: 'border-box',
};

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px', border: '1px solid #F3F4F6' }}>
      <p style={{ margin: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: '#9CA3AF', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 600, color: warn ? '#B45309' : '#1F2937', lineHeight: 1 }}>{value}</p>
    </div>
  );
}

function MiniTag({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      padding: '2px 6px', borderRadius: 4,
      background: ok ? 'rgba(45,106,79,0.1)' : 'rgba(180,83,9,0.1)',
      color: ok ? '#2D6A4F' : '#B45309',
    }}>
      {label}
    </span>
  );
}

// ── Agent card renderers ───────────────────────────────────────────────────

const AGENT_RENDERERS: Record<string, (agent: AgentData) => React.ReactNode> = {
  'Production Health': (a) => <HealthCard agent={a} />,
  'Merchant Activation': (a) => <ActivationCard agent={a} />,
  'Growth Content': (a) => <GrowthContentCard agent={a} />,
  'Agency Outreach': (a) => <AgencyOutreachCard agent={a} />,
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
      background: '#FFFFFF',
      color: '#1F2937',
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
              <span style={{ fontSize: 10, color: '#9CA3AF' }}>
                Updated {timeAgo(data.timestamp)}
              </span>
            )}
          </div>
          <a href="/dashboard" style={{ fontSize: 12, color: '#9CA3AF', textDecoration: 'none' }}>
            Back to Dashboard
          </a>
        </div>
        <div style={{ height: 1, background: '#E5E7EB', marginTop: 16 }} />
      </div>

      {/* Error / Loading */}
      {loading && (
        <div style={{ maxWidth: 1400, margin: '0 auto', textAlign: 'center', padding: 80 }}>
          <p style={{ color: '#9CA3AF' }}>Loading tower data...</p>
        </div>
      )}

      {error && (
        <div style={{ maxWidth: 1400, margin: '0 auto', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <p style={{ margin: 0, color: '#DC2626', fontSize: 14 }}>{error}</p>
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
                  background: '#FFFFFF',
                  borderRadius: 16,
                  border: '1px solid #E5E7EB',
                  overflow: 'hidden',
                  gridColumn: (agent.name === 'Merchant Activation') ? 'span 2' : undefined,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                {/* Card header */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '16px 20px',
                  borderBottom: '1px solid #F3F4F6',
                  background: '#FAFAFA',
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
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#1F2937' }}>{agent.name}</span>
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
                  borderTop: '1px solid #F3F4F6',
                  display: 'flex', justifyContent: 'flex-end',
                }}>
                  <span style={{ fontSize: 10, color: '#D1D5DB' }}>
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
