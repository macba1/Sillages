import { useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Spinner } from '../components/ui/Spinner';
import { useBriefs } from '../hooks/useBriefs';
import { useAccount } from '../hooks/useAccount';
import { useShopifyConnection } from '../hooks/useShopify';
import type { IntelligenceBrief } from '../types/index';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, opts?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat('en-US', opts).format(n);
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function WowBadge({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span className={`text-[10px] font-semibold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? '↑' : '↓'}{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ── Left sidebar components ──────────────────────────────────────────────────

function StatusCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-4 mb-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#7A6B63] mb-3">{title}</p>
      {children}
    </div>
  );
}

function CardRightNow({ brief, isGenerating }: { brief: IntelligenceBrief | null; isGenerating: boolean }) {
  const issue = brief?.section_whats_not_working?.items[0];

  let text: string;
  if (isGenerating) {
    text = 'Generating your first brief…';
  } else if (issue) {
    text = `Looking into ${issue.title.toLowerCase()} — ${issue.metric.toLowerCase()}`;
  } else {
    text = 'Monitoring your store data';
  }

  return (
    <StatusCard title="What I'm doing right now">
      <div className="flex items-start gap-2.5">
        <Loader2 size={13} className="animate-spin text-[#D8B07A] flex-shrink-0 mt-px" />
        <p className="text-sm text-[#3A2332] leading-relaxed">{text}</p>
      </div>
    </StatusCard>
  );
}

function CardYesterday({
  revenue,
  orders,
  wow,
}: {
  revenue: number | null | undefined;
  orders: number | null | undefined;
  wow: { revenue_pct: number | null; orders_pct: number | null } | null | undefined;
}) {
  if (revenue == null) {
    return (
      <StatusCard title="What I found yesterday">
        <p className="text-xs text-[#7A6B63]">No data yet — brief arrives tomorrow morning.</p>
      </StatusCard>
    );
  }

  return (
    <StatusCard title="What I found yesterday">
      <div className="flex flex-col gap-4">
        {/* Revenue row */}
        <div>
          <p className="text-[10px] font-medium text-[#7A6B63] mb-0.5">Revenue</p>
          <div className="flex items-baseline gap-2">
            <span className="text-[24px] font-bold text-[#3A2332] leading-none">
              {fmt(revenue, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
            </span>
            {wow?.revenue_pct != null && <WowBadge pct={wow.revenue_pct} />}
          </div>
        </div>
        {/* Orders row */}
        <div>
          <p className="text-[10px] font-medium text-[#7A6B63] mb-0.5">Orders</p>
          <div className="flex items-baseline gap-2">
            <span className="text-[24px] font-bold text-[#3A2332] leading-none">{orders}</span>
            {wow?.orders_pct != null && <WowBadge pct={wow.orders_pct} />}
          </div>
        </div>
      </div>
    </StatusCard>
  );
}

function CardWhatsNext({ brief }: { brief: IntelligenceBrief | null }) {
  const topProduct = brief?.section_yesterday?.top_product;
  const gap = brief?.section_gap;

  const items: { dot: string; text: string }[] = [];

  if (topProduct) {
    items.push({ dot: '#D8B07A', text: `Watching if ${topProduct} keeps selling` });
  } else {
    items.push({ dot: '#D8B07A', text: "Checking today's order trends" });
  }

  items.push({ dot: '#34D399', text: 'Brief ready by 6am tomorrow' });

  if (gap) {
    items.push({ dot: '#B0A8A0', text: gap.gap.replace(/\.$/, '') });
  } else {
    items.push({ dot: '#B0A8A0', text: 'Tracking whether more visitors complete their purchase' });
  }

  return (
    <StatusCard title="What's coming">
      <div className="flex flex-col gap-3">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span
              className="flex-shrink-0 rounded-full mt-[5px]"
              style={{ width: 7, height: 7, backgroundColor: item.dot }}
            />
            <p className="text-sm text-[#3A2332] leading-relaxed">{item.text}</p>
          </div>
        ))}
      </div>
    </StatusCard>
  );
}

// ── Right feed components ────────────────────────────────────────────────────

function SAvatar({ size = 8 }: { size?: number }) {
  const px = size * 4;
  return (
    <div
      className="rounded-full bg-[#D8B07A] flex items-center justify-center flex-shrink-0"
      style={{ width: px, height: px }}
    >
      <span className="text-white font-bold" style={{ fontSize: size < 10 ? 14 : 24 }}>S</span>
    </div>
  );
}

function BriefBubble({
  brief,
  firstName,
  isLatest,
}: {
  brief: IntelligenceBrief;
  firstName: string | undefined;
  isLatest: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <SAvatar size={8} />
      <div className={`flex-1 bg-white rounded-2xl shadow-sm px-5 py-4 ${!isLatest ? 'opacity-60' : ''}`}>
        {isLatest ? (
          <>
            <p className="text-[#3A2332] font-semibold leading-snug mb-2">
              {greeting()}{firstName ? `, ${firstName}` : ''}.
            </p>
            {brief.section_yesterday?.summary && (
              <p className="text-[#3A2332] text-sm leading-relaxed mb-4">
                {brief.section_yesterday.summary}
              </p>
            )}
            <Link
              to={`/briefs/${brief.id}`}
              className="text-[#D8B07A] font-semibold text-sm hover:underline"
            >
              Read full brief →
            </Link>
          </>
        ) : (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7A6B63] mb-2">
              {format(parseISO(brief.brief_date), 'EEEE, MMMM d')}
            </p>
            {brief.section_yesterday?.summary && (
              <p className="text-[#3A2332] text-sm leading-relaxed mb-3">
                {brief.section_yesterday.summary}
              </p>
            )}
            <Link
              to={`/briefs/${brief.id}`}
              className="text-[#D8B07A] text-sm font-medium hover:underline"
            >
              Read →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { account } = useAccount();
  const { briefs, loading, error, refetch } = useBriefs(account?.id);
  const { connection } = useShopifyConnection();
  const firstName = account?.full_name?.split(' ')[0];

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

  const wow = latest?.section_yesterday?.wow;
  const revenue = latest?.section_yesterday?.revenue;
  const orders = latest?.section_yesterday?.orders;

  const lastUpdatedLabel = connection?.last_synced_at
    ? `Last updated ${formatDistanceToNow(parseISO(connection.last_synced_at), { addSuffix: true })}`
    : null;

  return (
    <div className="min-h-screen md:h-screen md:overflow-hidden flex flex-col md:flex-row">

      {/* ── Left sidebar ── */}
      <aside className="bg-[#E8DDD4] md:w-[280px] md:flex-shrink-0 flex flex-col px-6 py-8 md:overflow-y-auto md:h-full">

        {/* Brand */}
        <div className="mb-7">
          <p className="text-[#D8B07A] font-bold text-[18px] uppercase tracking-wider">
            Sillages
          </p>
          <p className="text-[#7A6B63] text-[13px] mt-0.5">Working for you.</p>
        </div>

        {/* Agent avatar */}
        <div className="mb-7 flex flex-col items-start">
          <div className="w-16 h-16 rounded-full bg-[#D8B07A] ring-2 ring-[#D8B07A] ring-offset-2 ring-offset-[#E8DDD4] flex items-center justify-center mb-3">
            <span className="text-white font-bold text-2xl">S</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-emerald-700 text-xs font-semibold">Active</span>
          </div>
        </div>

        {/* Three status cards */}
        <CardRightNow brief={latest} isGenerating={isGenerating} />
        <CardYesterday revenue={revenue} orders={orders} wow={wow} />
        <CardWhatsNext brief={latest} />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Last updated timestamp */}
        {lastUpdatedLabel && (
          <p className="text-[10px] text-[#B0A8A0] mt-4">{lastUpdatedLabel}</p>
        )}
      </aside>

      {/* ── Right feed ── */}
      <main className="flex-1 bg-[#F7F1EC] p-8 md:overflow-y-auto md:h-full">

        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-100 p-5 text-sm text-red-700 rounded-xl">
            {error}
          </div>
        )}

        {/* Generating state */}
        {!loading && !error && isGenerating && (
          <div className="flex items-start gap-3 max-w-[600px]">
            <SAvatar size={8} />
            <div className="flex-1 bg-white rounded-2xl shadow-sm px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 size={14} className="animate-spin text-[#D8B07A]" />
                <p className="text-[#3A2332] font-semibold text-sm">Generating your first brief…</p>
              </div>
              <p className="text-[#7A6B63] text-sm leading-relaxed">
                We're pulling your store data right now. This usually takes under a minute.
              </p>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && !latest && !isGenerating && (
          <div className="flex items-start gap-3 max-w-[600px]">
            <SAvatar size={8} />
            <div className="flex-1 bg-white rounded-2xl shadow-sm px-5 py-4">
              <p className="text-[#3A2332] font-semibold mb-2">
                {greeting()}{firstName ? `, ${firstName}` : ''}.
              </p>
              <p className="text-[#7A6B63] text-sm leading-relaxed mb-2">
                Your first brief will arrive tomorrow morning, once your store data is ready.
              </p>
              <p className="text-xs text-[#7A6B63]">
                Make sure your Shopify store is connected in{' '}
                <a href="/settings" className="underline underline-offset-2 hover:text-[#3A2332] transition-colors">
                  Settings
                </a>
                .
              </p>
            </div>
          </div>
        )}

        {/* Brief feed */}
        {!loading && latest && (
          <div className="flex flex-col gap-4 max-w-[600px]">

            {/* Today's brief */}
            <BriefBubble brief={latest} firstName={firstName} isLatest />

            {/* Past briefs */}
            {past.length > 0 && (
              <>
                <div className="flex items-center gap-3 my-2">
                  <div className="flex-1 border-t border-[#D8CEC7]" />
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7A6B63]">
                    Previous briefings
                  </p>
                  <div className="flex-1 border-t border-[#D8CEC7]" />
                </div>
                <div className="flex flex-col gap-4">
                  {past.map(b => (
                    <BriefBubble key={b.id} brief={b} firstName={firstName} isLatest={false} />
                  ))}
                </div>
              </>
            )}

          </div>
        )}

      </main>
    </div>
  );
}
