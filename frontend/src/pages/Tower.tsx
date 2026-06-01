import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

interface CommandData {
  timestamp: string;
  sistema: { activeWorkflows: number; lastRun: string | null; errorsToday: number; tokensToday: number };
  merchants: { mrr: number; mrrPaying: number; trialsActive: number; trialToPaidWeek: number; atRisk: number; total: number };
  funnel: { nuevo: number; contactado: number; instalado: number; convertido: number; perdido: number };
  leadsTable: Array<{
    id: string; shopName: string; shopDomain: string; category: string | null;
    painScore: number; painTags: string[]; status: string; contactEmail: string | null;
    outreachPreview: string | null; contactedAt: string | null; createdAt: string;
  }>;
  nurturePipeline: Array<{
    accountId: string; email: string; name: string | null; plan: string;
    daysSinceInstall: number; timeline: Array<{ day: number; sent: boolean; current: boolean }>;
  }>;
  dailyChart: Array<{ date: string; leads: number; outreach: number }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#FFFFFF', color: '#1F2937', fontFamily: "'DM Sans', system-ui, sans-serif", padding: '24px' },
  maxW: { maxWidth: 1200, margin: '0 auto' },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 },
  card: { background: '#FFFFFF', borderRadius: 12, border: '1px solid #E5E7EB', padding: '20px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
  label: { margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#9CA3AF' },
  bigNum: { margin: '6px 0 0', fontSize: 28, fontWeight: 700, color: '#1F2937', lineHeight: 1 },
  sectionTitle: { margin: '32px 0 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase' as const, color: '#C9964A' },
  tag: { display: 'inline-block', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const, padding: '2px 6px', borderRadius: 4 },
};

// ── Page ────────────────────────────────────────────────────────────────────

export default function Tower() {
  const [data, setData] = useState<CommandData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const fetchData = useCallback(async () => {
    try {
      const { data: res } = await api.get('/api/tower/command');
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

  if (loading) return <div style={S.page}><div style={S.maxW}><p style={{ color: '#9CA3AF', padding: 80, textAlign: 'center' }}>Loading Command Center...</p></div></div>;
  if (error) return <div style={S.page}><div style={S.maxW}><p style={{ color: '#DC2626', padding: 40 }}>{error}</p></div></div>;
  if (!data) return null;

  const { sistema, merchants, funnel, leadsTable, nurturePipeline, dailyChart } = data;

  // Filter leads
  let filteredLeads = leadsTable;
  if (statusFilter !== 'all') filteredLeads = filteredLeads.filter(l => l.status === statusFilter);
  if (categoryFilter !== 'all') filteredLeads = filteredLeads.filter(l => l.category === categoryFilter);
  const categories = [...new Set(leadsTable.map(l => l.category).filter(Boolean))];

  return (
    <div style={S.page}>
      <div style={S.maxW}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', color: '#C9964A', textTransform: 'uppercase' }}>SILLAGES COMMAND CENTER</span>
            <span style={{ fontSize: 10, color: '#9CA3AF' }}>Updated {timeAgo(data.timestamp)}</span>
          </div>
          <a href="/dashboard" style={{ fontSize: 12, color: '#9CA3AF', textDecoration: 'none' }}>Dashboard</a>
        </div>
        <div style={{ height: 1, background: '#E5E7EB', marginBottom: 24 }} />

        {/* ── SECTION 1: SISTEMA ────────────────────────────────────── */}
        <div style={S.grid4}>
          <MetricCard label="Workflows activos" value={String(sistema.activeWorkflows)} color="#2D6A4F" />
          <MetricCard label="Último run" value={timeAgo(sistema.lastRun)} />
          <MetricCard label="Errores hoy" value={String(sistema.errorsToday)} color={sistema.errorsToday > 0 ? '#DC2626' : undefined} />
          <MetricCard label="Tokens hoy" value={sistema.tokensToday.toLocaleString()} />
        </div>

        {/* ── SECTION 2: MERCHANTS ──────────────────────────────────── */}
        <p style={S.sectionTitle}>Merchants</p>
        <div style={S.grid4}>
          <MetricCard label="MRR (total)" value={`$${merchants.mrr}`} color="#2D6A4F" sub={merchants.mrrPaying < merchants.mrr ? `$${merchants.mrrPaying} paying` : undefined} />
          <MetricCard label="Trials activos" value={String(merchants.trialsActive)} />
          <MetricCard label="Trial → Paid (7d)" value={String(merchants.trialToPaidWeek)} color={merchants.trialToPaidWeek > 0 ? '#2D6A4F' : undefined} />
          <MetricCard label="En riesgo" value={String(merchants.atRisk)} color={merchants.atRisk > 0 ? '#DC2626' : undefined} />
        </div>

        {/* ── SECTION 3: OUTREACH CRM FUNNEL ────────────────────────── */}
        <p style={S.sectionTitle}>Outreach CRM</p>

        {/* Funnel bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {([
            { label: 'Nuevo', count: funnel.nuevo, bg: '#F3F4F6', color: '#6B7280' },
            { label: 'Contactado', count: funnel.contactado, bg: '#DBEAFE', color: '#1D4ED8' },
            { label: 'Instalado', count: funnel.instalado, bg: '#D1FAE5', color: '#065F46' },
            { label: 'Convertido', count: funnel.convertido, bg: '#2D6A4F', color: '#FFFFFF' },
            { label: 'Perdido', count: funnel.perdido, bg: '#FEE2E2', color: '#991B1B' },
          ] as const).map(stage => (
            <div key={stage.label} style={{ flex: Math.max(stage.count, 1), background: stage.bg, borderRadius: 8, padding: '12px 16px', textAlign: 'center', minWidth: 80 }}>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: stage.color }}>{stage.count}</p>
              <p style={{ margin: '4px 0 0', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: stage.color, opacity: 0.7 }}>{stage.label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <FilterBtn label="All" active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
          {['new', 'draft', 'contacted', 'installed', 'converted', 'bounced'].map(s => (
            <FilterBtn key={s} label={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} />
          ))}
          <span style={{ width: 1, background: '#E5E7EB', margin: '0 4px' }} />
          <FilterBtn label="All categories" active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')} />
          {categories.map(c => (
            <FilterBtn key={c!} label={c!} active={categoryFilter === c} onClick={() => setCategoryFilter(c!)} />
          ))}
        </div>

        {/* Leads table */}
        <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #F3F4F6', background: '#FAFAFA' }}>
                {['Store', 'Category', 'Score', 'Status', 'Contacted', 'Message'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9CA3AF' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredLeads.slice(0, 50).map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontWeight: 600, color: '#1F2937' }}>{l.shopName}</span>
                    <br /><span style={{ fontSize: 11, color: '#9CA3AF' }}>{l.shopDomain}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ ...S.tag, background: '#F3F4F6', color: '#6B7280' }}>{l.category ?? '—'}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: l.painScore >= 60 ? '#DC2626' : l.painScore >= 30 ? '#B45309' : '#6B7280' }}>{l.painScore}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <StatusTag status={l.status} />
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 11, color: '#9CA3AF' }}>{l.contactedAt ? timeAgo(l.contactedAt) : '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#6B7280', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.outreachPreview ?? '—'}</td>
                </tr>
              ))}
              {filteredLeads.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>No leads match filters</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── SECTION 4: NURTURE PIPELINE ───────────────────────────── */}
        {nurturePipeline.length > 0 && (
          <>
            <p style={S.sectionTitle}>Nurture Pipeline</p>
            <div style={{ ...S.card }}>
              {nurturePipeline.map(m => (
                <div key={m.accountId} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0', borderBottom: '1px solid #F3F4F6' }}>
                  <div style={{ minWidth: 180 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1F2937' }}>{m.name ?? m.email}</span>
                    <br /><span style={{ fontSize: 11, color: '#9CA3AF' }}>{m.plan} · day {m.daysSinceInstall}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {m.timeline.map((step, i) => (
                      <div key={step.day} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 700,
                          background: step.sent ? '#2D6A4F' : step.current ? '#DBEAFE' : '#F3F4F6',
                          color: step.sent ? '#FFFFFF' : step.current ? '#1D4ED8' : '#9CA3AF',
                        }}>
                          D{step.day}
                        </div>
                        {i < m.timeline.length - 1 && <div style={{ width: 16, height: 2, background: step.sent ? '#2D6A4F' : '#E5E7EB' }} />}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── SECTION 5: DAILY CHART ────────────────────────────────── */}
        {dailyChart.length > 0 && (
          <>
            <p style={S.sectionTitle}>Last 30 Days</p>
            <div style={{ ...S.card }}>
              <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: '#1D4ED8' }}><span style={{ display: 'inline-block', width: 10, height: 10, background: '#1D4ED8', borderRadius: 2, marginRight: 4 }} />Leads</span>
                <span style={{ fontSize: 11, color: '#2D6A4F' }}><span style={{ display: 'inline-block', width: 10, height: 10, background: '#2D6A4F', borderRadius: 2, marginRight: 4 }} />Outreach</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
                {dailyChart.slice(-30).map(d => {
                  const maxVal = Math.max(...dailyChart.map(x => Math.max(x.leads, x.outreach)), 1);
                  const leadsH = (d.leads / maxVal) * 70;
                  const outreachH = (d.outreach / maxVal) * 70;
                  return (
                    <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }} title={`${d.date}: ${d.leads} leads, ${d.outreach} outreach`}>
                      <div style={{ width: '100%', display: 'flex', gap: 1, alignItems: 'flex-end', justifyContent: 'center' }}>
                        <div style={{ width: '45%', height: Math.max(leadsH, 2), background: '#1D4ED8', borderRadius: '2px 2px 0 0' }} />
                        <div style={{ width: '45%', height: Math.max(outreachH, 2), background: '#2D6A4F', borderRadius: '2px 2px 0 0' }} />
                      </div>
                      {d.date.endsWith('01') && <span style={{ fontSize: 8, color: '#9CA3AF', marginTop: 2 }}>{d.date.slice(5, 7)}/{d.date.slice(8)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ── SECTION 6: INBOX ─────────────────────────────────────── */}
        <InboxSection />

        <div style={{ height: 48 }} />
      </div>
    </div>
  );
}

// ── Inbox Section ──────────────────────────────────────────────────────────

interface InboxEmail {
  id: string; from_email: string; from_name: string | null; subject: string | null;
  category: string | null; status: string; ai_summary: string | null; received_at: string;
}

interface InboxDetail extends InboxEmail {
  body_text: string | null; body_html: string | null; ai_draft_reply: string | null;
}

const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  lead: { bg: '#DBEAFE', color: '#1D4ED8' },
  merchant: { bg: '#D1FAE5', color: '#065F46' },
  support: { bg: '#FEF3C7', color: '#92400E' },
  spam: { bg: '#F3F4F6', color: '#9CA3AF' },
};

function InboxSection() {
  const [emails, setEmails] = useState<InboxEmail[]>([]);
  const [unread, setUnread] = useState(0);
  const [selected, setSelected] = useState<InboxDetail | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [inboxFilter, setInboxFilter] = useState('all');

  const loadInbox = useCallback(async () => {
    try {
      const { data } = await api.get('/api/tower/inbox');
      setEmails(data.emails ?? []);
      setUnread(data.unreadCount ?? 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadInbox(); }, [loadInbox]);

  async function selectEmail(id: string) {
    try {
      const { data } = await api.get(`/api/tower/inbox/${id}`);
      setSelected(data.email);
      setReplyText(data.email.ai_draft_reply ?? '');
      void loadInbox(); // refresh unread count
    } catch { /* ignore */ }
  }

  async function sendReply() {
    if (!selected || !replyText.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/tower/inbox/${selected.id}/reply`, { message: replyText });
      setSelected(null);
      void loadInbox();
    } catch { /* ignore */ }
    setSending(false);
  }

  async function archiveEmail() {
    if (!selected) return;
    await api.patch(`/api/tower/inbox/${selected.id}`, { status: 'archived' });
    setSelected(null);
    void loadInbox();
  }

  const filtered = inboxFilter === 'all' ? emails : emails.filter(e => e.status === inboxFilter || e.category === inboxFilter);

  return (
    <>
      <p style={S.sectionTitle}>
        Inbox {unread > 0 && <span style={{ background: '#DC2626', color: '#fff', borderRadius: 10, padding: '2px 8px', fontSize: 10, fontWeight: 700, marginLeft: 8 }}>{unread}</span>}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '380px 1fr' : '1fr', gap: 16 }}>
        {/* Left: email list */}
        <div style={{ ...S.card, padding: 0, maxHeight: 500, overflowY: 'auto' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #F3F4F6', display: 'flex', gap: 4 }}>
            {['all', 'unread', 'lead', 'merchant', 'support'].map(f => (
              <FilterBtn key={f} label={f} active={inboxFilter === f} onClick={() => setInboxFilter(f)} />
            ))}
          </div>
          {filtered.length === 0 && <p style={{ padding: 32, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No emails</p>}
          {filtered.map(e => (
            <div key={e.id} onClick={() => selectEmail(e.id)} style={{
              padding: '12px 16px', borderBottom: '1px solid #F3F4F6', cursor: 'pointer',
              background: selected?.id === e.id ? '#F9FAFB' : e.status === 'unread' ? '#FAFBFF' : '#FFFFFF',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: e.status === 'unread' ? 700 : 500, color: '#1F2937' }}>
                  {e.from_name ?? e.from_email}
                </span>
                <span style={{ fontSize: 10, color: '#9CA3AF' }}>{timeAgo(e.received_at)}</span>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#1F2937', fontWeight: e.status === 'unread' ? 600 : 400 }}>{e.subject ?? '(no subject)'}</p>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                {e.category && <span style={{ ...S.tag, ...(CATEGORY_COLORS[e.category] ?? { bg: '#F3F4F6', color: '#9CA3AF' }) }}>{e.category}</span>}
                {e.ai_summary && <span style={{ fontSize: 11, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.ai_summary}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Right: detail panel */}
        {selected && (
          <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: 500, overflowY: 'auto' }}>
            <div>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9CA3AF' }}>From</p>
              <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600, color: '#1F2937' }}>{selected.from_name ?? selected.from_email} <span style={{ fontWeight: 400, color: '#9CA3AF' }}>&lt;{selected.from_email}&gt;</span></p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9CA3AF' }}>Subject</p>
              <p style={{ margin: '2px 0 0', fontSize: 14, color: '#1F2937' }}>{selected.subject ?? '(no subject)'}</p>
            </div>
            {selected.ai_summary && (
              <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '8px 12px', borderLeft: '3px solid #C9964A' }}>
                <p style={{ margin: 0, fontSize: 12, color: '#6B7280' }}><strong>AI:</strong> {selected.ai_summary}</p>
              </div>
            )}
            <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap', borderTop: '1px solid #F3F4F6', paddingTop: 12 }}>
              {selected.body_text ?? '(empty)'}
            </div>

            {/* Reply */}
            <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 12 }}>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9CA3AF' }}>Reply</p>
              <textarea
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                rows={5}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', boxSizing: 'border-box', color: '#1F2937' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={sendReply} disabled={sending} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#1F2937', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  {sending ? 'Sending...' : 'Send reply'}
                </button>
                <button onClick={archiveEmail} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  Archive
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Primitives ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={S.card}>
      <p style={S.label}>{label}</p>
      <p style={{ ...S.bigNum, color: color ?? '#1F2937' }}>{value}</p>
      {sub && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9CA3AF' }}>{sub}</p>}
    </div>
  );
}

function StatusTag({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    new: { bg: '#F3F4F6', color: '#6B7280' },
    draft: { bg: '#FEF3C7', color: '#92400E' },
    contacted: { bg: '#DBEAFE', color: '#1D4ED8' },
    installed: { bg: '#D1FAE5', color: '#065F46' },
    converted: { bg: '#2D6A4F', color: '#FFFFFF' },
    bounced: { bg: '#FEE2E2', color: '#991B1B' },
  };
  const c = colors[status] ?? colors.new;
  return <span style={{ ...S.tag, background: c.bg, color: c.color }}>{status}</span>;
}

function FilterBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
      background: active ? '#1F2937' : '#F3F4F6', color: active ? '#FFFFFF' : '#6B7280',
      fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s',
    }}>{label}</button>
  );
}
