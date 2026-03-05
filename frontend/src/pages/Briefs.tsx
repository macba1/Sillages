import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { AppShell } from '../components/layout/LeftNav';
import { Spinner } from '../components/ui/Spinner';
import { useBriefs } from '../hooks/useBriefs';
import { useAccount } from '../hooks/useAccount';
import type { IntelligenceBrief } from '../types/index';

function fmt(n: number, opts?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat('en-US', opts).format(n);
}

function BriefRow({ brief }: { brief: IntelligenceBrief }) {
  const date = parseISO(brief.brief_date);
  const s = brief.section_yesterday;

  return (
    <div
      className="flex gap-5"
      style={{ padding: '20px 0', borderBottom: '1px solid rgba(201,150,74,0.1)' }}
    >
      {/* Day number */}
      <div className="flex-shrink-0" style={{ width: 52, paddingTop: 4 }}>
        <span
          className="font-display"
          style={{ fontSize: 40, color: 'var(--ink-faint)', lineHeight: 1 }}
        >
          {format(date, 'd')}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 6 }}>
          {format(date, 'EEEE, MMMM · yyyy')}
        </p>

        {s?.summary && (
          <p
            className="line-clamp-2"
            style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.65, marginBottom: 10 }}
          >
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
            style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 500, textDecoration: 'none' }}
          >
            Read →
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function Briefs() {
  const { account } = useAccount();
  const { briefs, loading, error } = useBriefs(account?.id);

  return (
    <AppShell>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '64px 32px 80px' }}>

        <h1
          className="font-display fade-up"
          style={{ fontSize: 44, color: 'var(--ink)', lineHeight: 1.15, marginBottom: 48 }}
        >
          Your briefings.
        </h1>

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

        {!loading && !error && briefs.length === 0 && (
          <p style={{ fontSize: 15, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
            No briefs yet. Your first one will arrive tomorrow morning.
          </p>
        )}

        {!loading && briefs.length > 0 && (
          <div>
            {briefs.map(b => (
              <BriefRow key={b.id} brief={b} />
            ))}
          </div>
        )}

      </div>
    </AppShell>
  );
}
