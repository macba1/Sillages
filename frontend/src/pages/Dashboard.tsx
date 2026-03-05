import { useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { Navbar } from '../components/layout/Navbar';
import { Spinner } from '../components/ui/Spinner';
import { useBriefs } from '../hooks/useBriefs';
import { useAccount } from '../hooks/useAccount';
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

// ── Agent status footer ─────────────────────────────────────────────────────

function AgentStatus({ brief }: { brief: IntelligenceBrief }) {
  const topProduct = brief.section_yesterday?.top_product;
  const notWorking = brief.section_whats_not_working?.items[0];
  const action     = brief.section_activation?.what;

  return (
    <div className="mt-10 flex flex-col gap-1.5">
      <p className="text-xs text-[#7A6B63]">
        Tonight I'll check whether{' '}
        {topProduct ? <span className="text-[#3A2332]">{topProduct}</span> : 'your best seller'}{' '}
        held through today and trace where orders came from.
      </p>
      {notWorking && (
        <p className="text-xs text-[#7A6B63]">
          I'm keeping an eye on{' '}
          <span className="text-[#3A2332]">{notWorking.title.toLowerCase()}</span>
          {' '}— that's the one I'm most focused on fixing right now.
        </p>
      )}
      {action && (
        <p className="text-xs text-[#7A6B63]">
          If you haven't yet:{' '}
          <span className="text-[#3A2332]">{action}</span>
        </p>
      )}
      <p className="text-xs text-[#7A6B63]">Tomorrow's brief ready by 6am.</p>
    </div>
  );
}

// ── Latest brief pulse ──────────────────────────────────────────────────────

function LatestBrief({ brief }: { brief: IntelligenceBrief }) {
  const s = brief.section_yesterday;

  return (
    <div>
      {/* Summary — analyst's opening statement */}
      {s?.summary && (
        <p className="text-[#3A2332] text-lg leading-relaxed mb-8">
          {s.summary}
        </p>
      )}

      {/* 3 key metrics */}
      {s && (
        <div className="flex items-start gap-10 mb-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] mb-1">Revenue</p>
            <p className="text-2xl font-semibold text-[#3A2332] tracking-tight tabular-nums">
              {fmt(s.revenue, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] mb-1">Orders</p>
            <p className="text-2xl font-semibold text-[#3A2332] tracking-tight tabular-nums">
              {fmt(s.orders)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] mb-1">Conversion</p>
            <p className="text-2xl font-semibold text-[#3A2332] tracking-tight tabular-nums">
              {(s.conversion_rate * 100).toFixed(2)}%
            </p>
          </div>
        </div>
      )}

      {/* Read full brief */}
      <Link
        to={`/briefs/${brief.id}`}
        className="text-sm font-medium text-[#D8B07A] hover:underline underline-offset-2 transition-colors"
      >
        Read full brief →
      </Link>
    </div>
  );
}

// ── Past briefs list ────────────────────────────────────────────────────────

function PastBriefs({ briefs }: { briefs: IntelligenceBrief[] }) {
  return (
    <div className="mt-14 pt-10 border-t border-[#D8B07A]/30">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] mb-6">
        Past briefs
      </p>
      <div className="flex flex-col gap-5">
        {briefs.map((brief) => (
          <Link
            key={brief.id}
            to={`/briefs/${brief.id}`}
            className="group flex items-start justify-between gap-4"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[#3A2332] text-sm font-medium">
                {format(parseISO(brief.brief_date), 'EEEE, MMMM d')}
              </p>
              {brief.section_yesterday?.summary && (
                <p className="text-[#7A6B63] text-xs mt-0.5 line-clamp-1">
                  {brief.section_yesterday.summary}
                </p>
              )}
            </div>
            <span className="text-[#D8B07A] text-xs flex-shrink-0 mt-0.5 group-hover:underline underline-offset-2">
              Read →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { account } = useAccount();
  const { briefs, loading, error, refetch } = useBriefs(account?.id);
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
  const past   = briefs.slice(1);

  return (
    <div className="min-h-screen bg-[#F7F1EC]">
      <Navbar />
      <main className="max-w-[680px] mx-auto px-6 pt-24 pb-24">

        {/* Greeting + date */}
        <div className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] mb-3">
            {format(new Date(), 'EEEE, MMMM d')}
          </p>
          <h1 className="text-[#3A2332] text-4xl font-semibold tracking-tight leading-tight">
            {getGreeting()}{firstName ? `, ${firstName}` : ''}.
          </h1>
        </div>

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

        {/* Generating — just connected, waiting */}
        {!loading && !error && isGenerating && (
          <div className="flex flex-col items-center gap-4 text-center py-16">
            <Spinner size="lg" />
            <p className="text-[#3A2332] font-medium text-sm">Generating your first brief...</p>
            <p className="text-[#7A6B63] text-sm leading-relaxed max-w-xs">
              We're pulling your store data right now. This usually takes under a minute.
            </p>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && briefs.length === 0 && !isGenerating && (
          <div>
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

        {/* Latest brief pulse */}
        {!loading && latest && (
          <>
            <LatestBrief brief={latest} />

            <AgentStatus brief={latest} />

            {past.length > 0 && <PastBriefs briefs={past} />}
          </>
        )}

      </main>
    </div>
  );
}
