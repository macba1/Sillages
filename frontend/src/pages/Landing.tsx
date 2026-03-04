import { Link } from 'react-router-dom';

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

      {/* Brief Preview */}
      <section className="max-w-5xl mx-auto px-6 py-10 pb-20">
        <div className="border border-[#E8DDD6] bg-white">
          <div className="border-b border-[#E8DDD6] px-8 py-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] mb-1">Intelligence Brief</p>
              <p className="text-[#3A2332] font-semibold text-lg tracking-tight">Monday, March 2</p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-widest text-[#D8B07A] border border-[#D8B07A]/30 px-2.5 py-1">
              Ready
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#E8DDD6]">
            {[
              { label: 'Revenue', value: '$4,820' },
              { label: 'Orders', value: '38' },
              { label: 'Conversion', value: '3.4%' },
              { label: 'New customers', value: '22' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white px-6 py-5">
                <p className="text-xs uppercase tracking-widest text-[#7A6B63] font-medium mb-2">{stat.label}</p>
                <p className="text-2xl font-semibold text-[#3A2332] tracking-tight">{stat.value}</p>
              </div>
            ))}
          </div>
          <div className="px-8 py-6 border-t border-[#E8DDD6]">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] mb-3">Today's Activation</p>
            <p className="text-[#3A2332] font-semibold text-sm">
              Re-engage the 14 customers who added to cart but didn't purchase in the last 48 hours with a targeted 10% discount.
            </p>
          </div>
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
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between">
          <span className="text-[#3A2332] font-semibold text-sm tracking-tight">sillages</span>
          <p className="text-xs text-[#7A6B63]">© 2025 Sillages. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
