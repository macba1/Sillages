import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import type { Lang } from '../contexts/LanguageContext';

// ── Mock brief card ───────────────────────────────────────────────────────────

function BriefCard() {
  return (
    <div style={{
      width: 360,
      background: '#2A1F14',
      borderRadius: 24,
      padding: '32px',
      border: '1px solid rgba(201,150,74,0.2)',
      boxShadow: '0 32px 80px rgba(0,0,0,0.4)',
      animation: 'cardFadeUp 0.6s ease forwards',
      opacity: 0,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'rgba(201,150,74,0.15)',
            border: '1px solid rgba(201,150,74,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span style={{ color: '#C9964A', fontSize: 13, fontFamily: "'DM Serif Display', serif", fontWeight: 400 }}>S</span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C9964A' }}>
            Sillages
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="agent-pulse" style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#2D6A4F',
          }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#2D6A4F' }}>
            Active
          </span>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(201,150,74,0.15)', marginBottom: 20 }} />

      {/* Date */}
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(245,239,232,0.35)', marginBottom: 12 }}>
        Friday, March 6 · 2026
      </p>

      {/* Greeting */}
      <p style={{ fontSize: 22, color: '#F5EFE8', lineHeight: 1.3, marginBottom: 16, fontFamily: "'DM Serif Display', serif", fontWeight: 400 }}>
        Good morning, Tony.
      </p>

      {/* Body */}
      <p style={{ fontSize: 14, color: 'rgba(245,239,232,0.6)', lineHeight: 1.75, fontWeight: 300, marginBottom: 24 }}>
        I tracked $4,820 across 38 orders yesterday — your Vitamin C Serum carried the day, but only 3 out of every 100 visitors actually bought something, and I think I know exactly why.
      </p>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(201,150,74,0.15)', marginBottom: 20 }} />

      {/* Section label */}
      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#C9964A', marginBottom: 10 }}>
        One Thing to Do Today
      </p>

      {/* Action */}
      <p style={{ fontSize: 13, color: 'rgba(245,239,232,0.7)', lineHeight: 1.7, marginBottom: 24 }}>
        Send a follow-up email to everyone who looked at the Serum page yesterday but didn't buy. I'll tell you exactly what to write.
      </p>

      {/* Footer note */}
      <p style={{ fontSize: 11, color: 'rgba(245,239,232,0.25)', lineHeight: 1.6 }}>
        Tonight I'll pull today's data. Tomorrow's brief ready by 6am.
      </p>
    </div>
  );
}

// ── Value props ───────────────────────────────────────────────────────────────

const VALUE_PROPS = [
  {
    label: 'Daily Intelligence Brief',
    description:
      "Six focused sections delivered every morning: performance, momentum, friction, signal, gap, and today's activation. Clear thinking, not dashboards.",
  },
  {
    label: 'Actionable Signals',
    description:
      'Not a report. A decision. Each brief ends with one specific action — what to do, why it matters, how to execute in under 30 minutes.',
  },
  {
    label: 'Built for Operators',
    description:
      'For founders and store managers who need to move fast and move right. No charts to interpret. No filters to configure. Just clarity.',
  },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Landing() {
  const { lang, setLang } = useLanguage();

  return (
    <div className="min-h-screen bg-[#F7F1EC]">

      {/* Fixed language toggle */}
      <div style={{ position: 'fixed', top: 24, right: 24, zIndex: 100, display: 'flex', gap: 4 }}>
        {(['en', 'es'] as Lang[]).map(l => (
          <button
            key={l}
            onClick={() => setLang(l)}
            style={{
              padding: '4px 10px',
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif",
              letterSpacing: '0.08em',
              cursor: 'pointer',
              border: 'none',
              background: lang === l ? '#C9964A' : 'rgba(58,35,50,0.08)',
              color: lang === l ? '#2A1F14' : '#A89880',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Nav */}
      <header className="border-b border-[#E8DDD6] bg-[#F7F1EC]">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-[#3A2332] font-semibold tracking-tight text-base">sillages</span>
          <div className="flex items-center gap-6">
            <Link
              to="/login"
              className="text-sm text-[#7A6B63] hover:text-[#3A2332] transition-colors"
            >
              Sign in
            </Link>
            <Link
              to="/login"
              className="bg-[#D8B07A] text-[#1A1A2E] text-sm font-medium px-4 py-2 hover:bg-[#c9a06a] transition-colors"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero — two column on desktop */}
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-20">
        <div style={{ display: 'flex', alignItems: 'center', gap: 64, flexWrap: 'wrap' }}>
          {/* Left: text */}
          <div style={{ flex: '1 1 340px', minWidth: 280 }}>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#D8B07A] mb-6">
              Intelligence for Shopify operators
            </p>
            <h1 className="text-[#3A2332] text-5xl font-semibold tracking-tight leading-[1.1] mb-6">
              Your store worked yesterday.
              <br />
              Do you know what it told you?
            </h1>
            <p className="text-[#7A6B63] text-lg leading-relaxed mb-10">
              Sillages analyzes your Shopify store every night and delivers a clear morning brief —
              what moved, what stalled, and exactly what to do today.
            </p>
            <div className="flex items-center gap-4">
              <Link
                to="/login"
                className="bg-[#D8B07A] text-[#1A1A2E] font-medium px-6 py-3 text-sm hover:bg-[#c9a06a] transition-colors"
              >
                Start free trial
              </Link>
              <a
                href="#how-it-works"
                className="text-sm text-[#7A6B63] hover:text-[#3A2332] transition-colors"
              >
                See how it works →
              </a>
            </div>
          </div>

          {/* Right: mock brief card */}
          <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', maxWidth: 360 }}>
            <BriefCard />
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="max-w-5xl mx-auto px-6">
        <div className="border-t border-[#E8DDD6]" />
      </div>

      {/* Value Props */}
      <section id="how-it-works" className="max-w-5xl mx-auto px-6 py-20">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] mb-12">
          What you get
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[#E8DDD6]">
          {VALUE_PROPS.map((prop) => (
            <div key={prop.label} className="bg-[#F7F1EC] p-8">
              <h3 className="text-[#3A2332] font-semibold text-base mb-3 tracking-tight">
                {prop.label}
              </h3>
              <p className="text-[#7A6B63] text-sm leading-relaxed">{prop.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Beta pricing notice */}
      <div className="max-w-5xl mx-auto px-6 py-20">
        <div className="border-t border-[#E8DDD6]" />
        <div className="mt-16 border border-[#E8DDD6] bg-white px-10 py-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#D8B07A] mb-2">Beta</p>
            <p className="text-[#3A2332] font-semibold text-lg tracking-tight">
              Sillages is free during beta.
            </p>
            <p className="text-[#7A6B63] text-sm mt-1">
              Pricing starts at $9/month when we launch. No credit card required.
            </p>
          </div>
          <Link
            to="/login"
            className="flex-shrink-0 bg-[#D8B07A] text-[#1A1A2E] font-medium px-6 py-3 text-sm hover:bg-[#c9a06a] transition-colors text-center"
          >
            Get free access
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#E8DDD6]">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-[#7A6B63]">© 2026 Sillages. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <Link to="/privacy" className="text-xs text-[#7A6B63] hover:text-[#3A2332] transition-colors">
              Privacy Policy
            </Link>
            <Link to="/terms" className="text-xs text-[#7A6B63] hover:text-[#3A2332] transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
