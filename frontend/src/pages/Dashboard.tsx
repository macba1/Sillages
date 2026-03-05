import { useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { parseISO, formatDistanceToNow } from 'date-fns';
import { Navbar } from '../components/layout/Navbar';
import { Spinner } from '../components/ui/Spinner';
import { useBriefs } from '../hooks/useBriefs';
import { useAccount } from '../hooks/useAccount';
import { useShopifyConnection } from '../hooks/useShopify';
import type { IntelligenceBrief } from '../types/index';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function fmt(n: number, opts?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat('en-US', opts).format(n);
}

function N({ children }: { children: React.ReactNode }) {
  return <span className="text-[#D8B07A] font-semibold">{children}</span>;
}

// ── Zone 1 — Agent status bar ───────────────────────────────────────────────

function AgentStatusBar({
  brief,
  lastSyncedAt,
}: {
  brief: IntelligenceBrief | null;
  lastSyncedAt: string | null;
}) {
  const syncLabel = lastSyncedAt
    ? `Last sync: ${formatDistanceToNow(parseISO(lastSyncedAt), { addSuffix: true })}`
    : 'Last sync: checking...';

  const topIssue = brief?.section_whats_not_working?.items[0];
  const focusLine = topIssue
    ? `I'm watching ${topIssue.title.toLowerCase()} — ${topIssue.metric.toLowerCase()}.`
    : "I'm watching your store data and getting tomorrow's brief ready.";

  return (
    <div className="mb-10 pb-8 border-b border-[#E8DDD6]">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-xs font-semibold text-[#3A2332]">Sillages is active</span>
        <span className="text-xs text-[#7A6B63]">·</span>
        <span className="text-xs text-[#7A6B63]">{syncLabel}</span>
      </div>
      <p className="text-sm text-[#7A6B63] leading-relaxed">{focusLine}</p>
    </div>
  );
}

// ── Zone 2 — Today's snapshot ───────────────────────────────────────────────

function TodaySnapshot({
  brief,
  firstName,
}: {
  brief: IntelligenceBrief;
  firstName: string | undefined;
}) {
  const s = brief.section_yesterday;
  const buyersPer100 = s ? Math.round(s.conversion_rate * 100) : null;

  return (
    <div className="mb-10">
      <h1 className="text-[#3A2332] text-4xl font-semibold tracking-tight leading-tight mb-5">
        {getGreeting()}{firstName ? `, ${firstName}` : ''}.
      </h1>

      {s?.summary && (
        <p className="text-[#3A2332] text-base leading-relaxed mb-5">
          {s.summary}
        </p>
      )}

      {s && (
        <p className="text-[#3A2332] text-sm leading-relaxed mb-8">
          Yesterday:{' '}
          <N>{fmt(s.revenue, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</N>
          {' '}across{' '}
          <N>{fmt(s.orders)} orders</N>
          {buyersPer100 !== null && (
            <>
              {' '}—{' '}
              <N>{buyersPer100} out of every 100</N>
              {' '}visitors bought something.
            </>
          )}
        </p>
      )}

      <Link
        to={`/briefs/${brief.id}`}
        className="inline-block bg-[#D8B07A] text-[#1A1A2E] text-sm font-semibold px-5 py-2.5 hover:bg-[#c9a06a] transition-colors"
      >
        Read this morning's brief →
      </Link>
    </div>
  );
}

// ── Zone 3 — What's happening next ─────────────────────────────────────────

function NextActions({ brief }: { brief: IntelligenceBrief }) {
  const s           = brief.section_yesterday;
  const notWorking  = brief.section_whats_not_working?.items[0];
  const gap         = brief.section_gap;
  const topProduct  = s?.top_product;
  const lines: string[] = [];

  if (topProduct) {
    lines.push(`Tonight — checking if ${topProduct} keeps selling or was a one-day spike`);
  }

  if (notWorking) {
    lines.push(`Tonight — looking into ${notWorking.title.toLowerCase()} (${notWorking.metric.toLowerCase()})`);
  } else if (s && s.orders > 0) {
    lines.push(`Tonight — pulling today's orders and comparing against yesterday`);
  }

  lines.push(`Tomorrow — your brief will be ready by 6am`);

  if (gap) {
    lines.push(`This week — ${gap.gap.toLowerCase().replace(/\.$/, '')}`);
  } else {
    lines.push(`This week — tracking whether more people complete their purchase`);
  }

  return (
    <div className="pt-8 border-t border-[#E8DDD6]">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] mb-5">
        What's happening next
      </p>
      <div className="flex flex-col gap-3">
        {lines.slice(0, 4).map((line, i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="text-[#D8B07A] flex-shrink-0 mt-px text-xs">◉</span>
            <p className="text-sm text-[#3A2332] leading-relaxed">{line}</p>
          </div>
        ))}
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

  return (
    <div className="min-h-screen bg-[#F7F1EC]">
      <Navbar />
      <main className="max-w-[680px] mx-auto px-6 pt-24 pb-24">

        {/* Zone 1 — always visible */}
        <AgentStatusBar
          brief={latest}
          lastSyncedAt={connection?.last_synced_at ?? null}
        />

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-100 p-5 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Generating — just connected, waiting for first brief */}
        {!loading && !error && isGenerating && (
          <div className="flex flex-col items-center gap-4 text-center py-16">
            <Spinner size="lg" />
            <p className="text-[#3A2332] font-medium text-sm">Generating your first brief...</p>
            <p className="text-[#7A6B63] text-sm leading-relaxed max-w-xs">
              We're pulling your store data right now. This usually takes under a minute.
            </p>
          </div>
        )}

        {/* Empty — no brief yet */}
        {!loading && !error && !latest && !isGenerating && (
          <div>
            <h1 className="text-[#3A2332] text-4xl font-semibold tracking-tight leading-tight mb-5">
              {getGreeting()}{firstName ? `, ${firstName}` : ''}.
            </h1>
            <p className="text-[#7A6B63] text-sm leading-relaxed mb-4">
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
        )}

        {/* Zones 2 + 3 — brief exists */}
        {!loading && latest && (
          <>
            <TodaySnapshot brief={latest} firstName={firstName} />
            <NextActions brief={latest} />
          </>
        )}

      </main>
    </div>
  );
}
