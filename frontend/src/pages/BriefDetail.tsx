import { useParams, Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '../components/layout/LeftNav';
import { Spinner } from '../components/ui/Spinner';
import { useBrief } from '../hooks/useBriefs';
import { useLanguage } from '../contexts/LanguageContext';
import type { IntelligenceBrief } from '../types/index';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wrap dollar amounts in gold spans. */
function Gold({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--gold)', fontWeight: 500 }}>{children}</span>;
}

function HighlightNumbers({ text }: { text: string }) {
  const parts = text.split(/(\$[\d,]+(?:\.\d+)?)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('$') ? <Gold key={i}>{part}</Gold> : <span key={i}>{part}</span>
      )}
    </>
  );
}

// ── Brief section wrapper ─────────────────────────────────────────────────────

function BriefSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 48 }}>
      <div className="flex items-center gap-3" style={{ marginBottom: 20 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gold)', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(201,150,74,0.2)' }} />
      </div>
      {children}
    </section>
  );
}

// ── Brief conversation ────────────────────────────────────────────────────────

function BriefBody({ brief, t }: { brief: IntelligenceBrief; t: ReturnType<typeof useLanguage>['t'] }) {
  const w   = brief.section_whats_working;
  const n   = brief.section_whats_not_working;
  const sig = brief.section_signal;
  const gap = brief.section_gap;
  const act = brief.section_activation;

  return (
    <div>
      {/* What worked */}
      {w && w.items.length > 0 && (
        <BriefSection label={t('brief.section.worked')}>
          <div className="flex flex-col" style={{ gap: 20 }}>
            {w.items.map((item, i) => (
              <p key={i} style={{ fontSize: 15, color: 'var(--ink)', lineHeight: 1.7 }}>
                <span style={{ fontWeight: 600 }}>{item.title}</span>
                {' — '}
                <Gold>{item.metric}</Gold>
                {'. '}
                <HighlightNumbers text={item.insight} />
              </p>
            ))}
          </div>
        </BriefSection>
      )}

      {/* What didn't */}
      {n && n.items.length > 0 && (
        <BriefSection label={t('brief.section.notWorked')}>
          <div className="flex flex-col" style={{ gap: 20 }}>
            {n.items.map((item, i) => (
              <p key={i} style={{ fontSize: 15, color: 'var(--ink)', lineHeight: 1.7 }}>
                <span style={{ fontWeight: 600 }}>{item.title}</span>
                {' — '}
                <Gold>{item.metric}</Gold>
                {'. '}
                <HighlightNumbers text={item.insight} />
              </p>
            ))}
          </div>
        </BriefSection>
      )}

      {/* Signal */}
      {sig && (
        <BriefSection label={t('brief.section.watching')}>
          <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 14 }}>
            {sig.headline}
          </p>
          <p style={{ fontSize: 15, color: 'var(--ink-muted)', lineHeight: 1.75, marginBottom: 10 }}>
            {sig.market_context}
          </p>
          <p style={{ fontSize: 15, color: 'var(--ink-muted)', lineHeight: 1.75 }}>
            {sig.store_implication}
          </p>
        </BriefSection>
      )}

      {/* Gap */}
      {gap && (
        <BriefSection label={t('brief.section.gap')}>
          <p style={{ fontSize: 15, color: 'var(--ink)', lineHeight: 1.75, marginBottom: 10 }}>
            <HighlightNumbers text={gap.gap} />
          </p>
          <p style={{ fontSize: 15, color: 'var(--ink-muted)', lineHeight: 1.75, marginBottom: 14 }}>
            <HighlightNumbers text={gap.opportunity} />
          </p>
          <p style={{ fontSize: 14, color: 'var(--ink-muted)' }}>
            {t('brief.upside')} <Gold>{gap.estimated_upside}</Gold>
          </p>
        </BriefSection>
      )}

      {/* Activation */}
      {act && (
        <BriefSection label={t('brief.section.activation')}>
          <div style={{ background: 'var(--white)', borderRadius: 16, padding: 24 }}>
            <p
              className="font-display"
              style={{ fontSize: 22, color: 'var(--ink)', lineHeight: 1.3, marginBottom: 12 }}
            >
              {act.what}
            </p>
            <p style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.75, marginBottom: 20 }}>
              {act.why}
            </p>
            <ol style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              {act.how.map((step, i) => (
                <li key={i} style={{ display: 'flex', gap: 12 }}>
                  <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 13, flexShrink: 0, paddingTop: 2 }}>
                    {i + 1}.
                  </span>
                  <span style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.65 }}>{step}</span>
                </li>
              ))}
            </ol>
            <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
              {t('brief.expected')} <Gold>{act.expected_impact}</Gold>
            </p>
          </div>
        </BriefSection>
      )}

      {/* Footer */}
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', paddingTop: 8 }}>
        {t('brief.footer')}
      </p>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function BriefDetail() {
  const { id } = useParams<{ id: string }>();
  const { brief, loading, error } = useBrief(id);
  const { t } = useLanguage();

  return (
    <AppShell>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '64px 32px 80px' }}>

        {/* Back link */}
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2"
          style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)', textDecoration: 'none', marginBottom: 40, transition: 'color 0.15s' }}
        >
          <ArrowLeft size={12} />
          {t('brief.back')}
        </Link>

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

        {!loading && brief && (
          <>
            {/* Header */}
            <div style={{ marginBottom: 40 }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 12 }}>
                {format(parseISO(brief.brief_date), 'EEEE, MMMM d · yyyy')}
              </p>

              {/* Headline from yesterday's summary */}
              {brief.section_yesterday?.summary && (
                <h1
                  className="font-display fade-up"
                  style={{ fontSize: 36, color: 'var(--ink)', lineHeight: 1.2, marginBottom: 0 }}
                >
                  {brief.section_yesterday.summary}
                </h1>
              )}
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'rgba(201,150,74,0.2)', marginBottom: 48 }} />

            <BriefBody brief={brief} t={t} />
          </>
        )}
      </div>
    </AppShell>
  );
}
