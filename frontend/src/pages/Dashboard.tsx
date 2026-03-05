import { useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { Navbar } from '../components/layout/Navbar';
import { Spinner } from '../components/ui/Spinner';
import { useBriefs } from '../hooks/useBriefs';
import { useAccount } from '../hooks/useAccount';
import type { IntelligenceBrief } from '../types/index';

// ── Primitives ─────────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function Divider() {
  return <div className="border-t border-[#D8B07A]/30 my-10" />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] mb-5">
      {children}
    </p>
  );
}

function Metric({ children }: { children: React.ReactNode }) {
  return <span className="text-[#D8B07A] font-semibold">{children}</span>;
}

// ── Main brief view ─────────────────────────────────────────────────────────

function BriefConversation({
  brief,
  firstName,
}: {
  brief: IntelligenceBrief;
  firstName: string | undefined;
}) {
  const s   = brief.section_yesterday;
  const w   = brief.section_whats_working;
  const n   = brief.section_whats_not_working;
  const sig = brief.section_signal;
  const gap = brief.section_gap;
  const act = brief.section_activation;

  return (
    <div>

      {/* Greeting */}
      <div className="mb-10">
        <h1 className="text-[#3A2332] text-4xl font-semibold tracking-tight leading-tight mb-5">
          {getGreeting()}{firstName ? `, ${firstName}` : ''}.
        </h1>
        {s?.summary && (
          <p className="text-[#3A2332] text-lg leading-relaxed">
            {s.summary}
          </p>
        )}
      </div>

      <Divider />

      {/* What worked */}
      {w && w.items.length > 0 && (
        <>
          <section>
            <SectionLabel>What worked yesterday</SectionLabel>
            <div className="flex flex-col gap-6">
              {w.items.map((item, i) => (
                <p key={i} className="text-[#3A2332] text-sm leading-relaxed">
                  <span className="font-semibold">{item.title}</span>
                  {' — '}
                  <Metric>{item.metric}</Metric>
                  {'. '}
                  {item.insight}
                </p>
              ))}
            </div>
          </section>
          <Divider />
        </>
      )}

      {/* What didn't */}
      {n && n.items.length > 0 && (
        <>
          <section>
            <SectionLabel>What didn't</SectionLabel>
            <div className="flex flex-col gap-6">
              {n.items.map((item, i) => (
                <p key={i} className="text-[#3A2332] text-sm leading-relaxed">
                  <span className="font-semibold">{item.title}</span>
                  {' — '}
                  <Metric>{item.metric}</Metric>
                  {'. '}
                  {item.insight}
                </p>
              ))}
            </div>
          </section>
          <Divider />
        </>
      )}

      {/* Signal */}
      {sig && (
        <>
          <section>
            <SectionLabel>What I'm watching</SectionLabel>
            <p className="text-[#3A2332] font-semibold text-base leading-snug mb-4">
              {sig.headline}
            </p>
            <p className="text-[#3A2332] text-sm leading-relaxed mb-3">
              {sig.market_context}
            </p>
            <p className="text-[#3A2332] text-sm leading-relaxed">
              {sig.store_implication}
            </p>
          </section>
          <Divider />
        </>
      )}

      {/* Gap */}
      {gap && (
        <>
          <section>
            <SectionLabel>The gap</SectionLabel>
            <p className="text-[#3A2332] text-sm leading-relaxed mb-3">
              {gap.gap}
            </p>
            <p className="text-[#3A2332] text-sm leading-relaxed mb-4">
              {gap.opportunity}
            </p>
            <p className="text-sm">
              <span className="text-[#7A6B63]">Upside: </span>
              <Metric>{gap.estimated_upside}</Metric>
            </p>
          </section>
          <Divider />
        </>
      )}

      {/* Activation */}
      {act && (
        <>
          <section>
            <SectionLabel>One thing to do today</SectionLabel>
            <p className="text-[#3A2332] font-semibold text-base leading-snug mb-4">
              {act.what}
            </p>
            <p className="text-[#3A2332] text-sm leading-relaxed mb-6">
              {act.why}
            </p>
            <ol className="flex flex-col gap-3 mb-6">
              {act.how.map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-[#3A2332] leading-relaxed">
                  <span className="text-[#D8B07A] font-semibold flex-shrink-0 w-4 pt-px">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="text-sm text-[#7A6B63]">
              Expected: <Metric>{act.expected_impact}</Metric>
            </p>
          </section>
          <Divider />
        </>
      )}

      {/* Footer line */}
      <p className="text-xs text-[#7A6B63]">
        Tonight I'll pull today's data. Tomorrow's brief ready by 6am.
      </p>

    </div>
  );
}

// ── Past briefs ─────────────────────────────────────────────────────────────

function PastBriefs({ briefs }: { briefs: IntelligenceBrief[] }) {
  return (
    <div className="mt-16 pt-10 border-t border-[#D8B07A]/30">
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

// ── Page ───────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { account } = useAccount();
  const { briefs, loading, error, refetch } = useBriefs(account?.id);
  const firstName = account?.full_name?.split(' ')[0];

  const [searchParams] = useSearchParams();
  const justConnected = searchParams.get('connected') === 'true';

  // Poll every 5s while waiting for the first brief to generate
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
          <div className="flex flex-col items-center gap-4 text-center py-20">
            <Spinner size="lg" />
            <p className="text-[#3A2332] font-medium text-sm">Generating your first brief...</p>
            <p className="text-[#7A6B63] text-sm leading-relaxed max-w-xs">
              We're pulling your store data right now. This usually takes under a minute.
            </p>
          </div>
        )}

        {/* Empty — no brief, not generating */}
        {!loading && !error && briefs.length === 0 && !isGenerating && (
          <div>
            <h1 className="text-[#3A2332] text-4xl font-semibold tracking-tight leading-tight mb-5">
              {getGreeting()}{firstName ? `, ${firstName}` : ''}.
            </h1>
            <p className="text-[#7A6B63] text-sm leading-relaxed mb-6">
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

        {/* Main brief */}
        {!loading && latest && (
          <>
            <BriefConversation brief={latest} firstName={firstName} />
            {past.length > 0 && <PastBriefs briefs={past} />}
          </>
        )}

      </main>
    </div>
  );
}
