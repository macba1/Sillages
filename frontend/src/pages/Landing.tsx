import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const AGENT_LINES = [
  { text: 'I tracked $4,820 across 38 orders yesterday...', color: '#F5EFE8' },
  { text: 'Your Vitamin C Serum carried the day...', color: '#C9964A' },
  { text: 'Only 3 out of 100 visitors bought something...', color: '#F5EFE8' },
  { text: "Here's what I think is happening and what to do today.", color: '#F5EFE8' },
];

function AgentCard() {
  const [visibleLines, setVisibleLines] = useState(0);
  const [looping, setLooping] = useState(false);

  useEffect(() => {
    if (visibleLines < AGENT_LINES.length) {
      const delay = visibleLines === 0 ? 600 : 1500;
      const t = setTimeout(() => setVisibleLines(v => v + 1), delay);
      return () => clearTimeout(t);
    } else {
      // pause then restart loop
      const t = setTimeout(() => {
        setLooping(true);
        setVisibleLines(0);
        setLooping(false);
      }, 3500);
      return () => clearTimeout(t);
    }
  }, [visibleLines, looping]);

  return (
    <div style={{
      background: '#2A1F14',
      borderRadius: 16,
      padding: '28px 32px',
      maxWidth: 520,
      margin: '0 auto',
      boxShadow: '0 32px 64px rgba(42,31,20,0.18)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%',
          background: 'rgba(201,150,74,0.15)',
          border: '1px solid rgba(201,150,74,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ color: '#C9964A', fontSize: 15, fontWeight: 700, fontFamily: "'DM Serif Display', serif" }}>S</span>
        </div>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#F5EFE8', marginBottom: 3 }}>Sillages</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="agent-pulse" style={{
              display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#2D6A4F',
            }} />
            <span style={{ fontSize: 11, color: '#7A6A58', letterSpacing: '0.03em' }}>Writing your brief…</span>
          </div>
        </div>
      </div>

      {/* Lines */}
      <div style={{ minHeight: 120 }}>
        {AGENT_LINES.slice(0, visibleLines).map((line, i) => (
          <p
            key={i}
            style={{
              fontSize: 15, color: line.color, lineHeight: 1.75, marginBottom: 10,
              animation: 'fadeSlideIn 0.4s ease forwards',
            }}
          >
            {line.text}
            {i === visibleLines - 1 && visibleLines < AGENT_LINES.length && (
              <span style={{
                display: 'inline-block', width: 2, height: 14, background: '#C9964A',
                marginLeft: 3, verticalAlign: 'middle',
                animation: 'blink 1s step-end infinite',
              }} />
            )}
          </p>
        ))}
      </div>
    </div>
  );
}

const VALUE_PROPS = [
  {
    label: 'Daily Intelligence Brief',
    description:
      'Six focused sections delivered every morning: performance, momentum, friction, signal, gap, and today\'s activation. Clear thinking, not dashboards.',
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


export default function Landing() {
  return (
    <div className="min-h-screen bg-[#F7F1EC]">
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

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-20">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#D8B07A] mb-6">
            Intelligence for Shopify operators
          </p>
          <h1 className="text-[#3A2332] text-5xl font-semibold tracking-tight leading-[1.1] mb-6">
            Your store worked yesterday.
            <br />
            Do you know what it told you?
          </h1>
          <p className="text-[#7A6B63] text-lg leading-relaxed mb-10 max-w-xl">
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

      {/* Agent card */}
      <section className="max-w-5xl mx-auto px-6 py-10 pb-20">
        <AgentCard />
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
