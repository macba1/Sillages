import { useParams, Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { Navbar } from '../components/layout/Navbar';
import { Spinner } from '../components/ui/Spinner';
import { useBrief } from '../hooks/useBriefs';
import type { IntelligenceBrief } from '../types/index';

// ── Primitives ──────────────────────────────────────────────────────────────

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

// ── Full conversational brief ───────────────────────────────────────────────

function BriefConversation({ brief }: { brief: IntelligenceBrief }) {
  const s   = brief.section_yesterday;
  const w   = brief.section_whats_working;
  const n   = brief.section_whats_not_working;
  const sig = brief.section_signal;
  const gap = brief.section_gap;
  const act = brief.section_activation;

  return (
    <div>

      {/* Opening statement */}
      {s?.summary && (
        <>
          <p className="text-[#3A2332] text-lg leading-relaxed">
            {s.summary}
          </p>
          <Divider />
        </>
      )}

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

      {/* Footer */}
      <p className="text-xs text-[#7A6B63]">
        Tonight I'll pull today's data. Tomorrow's brief ready by 6am.
      </p>

    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function BriefDetail() {
  const { id } = useParams<{ id: string }>();
  const { brief, loading, error } = useBrief(id);

  return (
    <div className="min-h-screen bg-[#F7F1EC]">
      <Navbar />
      <main className="max-w-[680px] mx-auto px-6 pt-20 pb-24">

        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-[#7A6B63] hover:text-[#3A2332] text-xs font-medium uppercase tracking-widest transition-colors mb-10"
        >
          <ArrowLeft size={12} />
          Back
        </Link>

        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-100 p-5 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && brief && (
          <>
            {/* Header */}
            <div className="mb-10">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] mb-3">
                {format(parseISO(brief.brief_date), 'EEEE, MMMM d · yyyy')}
              </p>
              <h1 className="text-[#3A2332] text-3xl font-semibold tracking-tight">
                Intelligence Brief
              </h1>
            </div>

            <BriefConversation brief={brief} />
          </>
        )}

      </main>
    </div>
  );
}
