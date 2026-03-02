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

const PLANS = [
  {
    name: 'Starter',
    price: '$29',
    period: '/mo',
    description: 'One store, one clear morning brief.',
    features: ['1 Shopify store', 'Daily intelligence brief', 'All 6 brief sections', 'Email delivery'],
    cta: 'Start free trial',
    featured: false,
  },
  {
    name: 'Growth',
    price: '$79',
    period: '/mo',
    description: 'For operators running multiple storefronts.',
    features: ['Up to 3 Shopify stores', 'Daily intelligence brief', 'All 6 brief sections', 'Email delivery', 'Priority generation'],
    cta: 'Start free trial',
    featured: true,
  },
  {
    name: 'Pro',
    price: '$149',
    period: '/mo',
    description: 'Full access for agencies and power users.',
    features: ['Unlimited stores', 'Daily intelligence brief', 'All 6 brief sections', 'Email delivery', 'API access', 'Dedicated support'],
    cta: 'Contact us',
    featured: false,
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
            <a href="#pricing" className="text-sm text-[#7A6B63] hover:text-[#3A2332] transition-colors">
              Pricing
            </a>
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

      {/* Divider */}
      <div className="max-w-5xl mx-auto px-6">
        <div className="border-t border-[#E8DDD6]" />
      </div>

      {/* Pricing */}
      <section id="pricing" className="max-w-5xl mx-auto px-6 py-20">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7A6B63] mb-3">Pricing</p>
        <h2 className="text-[#3A2332] text-3xl font-semibold tracking-tight mb-12">
          Simple, transparent pricing.
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`border p-8 flex flex-col ${
                plan.featured
                  ? 'border-[#D8B07A] bg-white'
                  : 'border-[#E8DDD6] bg-[#F7F1EC]'
              }`}
            >
              {plan.featured && (
                <p className="text-xs font-semibold uppercase tracking-widest text-[#D8B07A] mb-4">
                  Most popular
                </p>
              )}
              <h3 className="text-[#3A2332] font-semibold text-lg tracking-tight mb-1">{plan.name}</h3>
              <p className="text-[#7A6B63] text-sm mb-6">{plan.description}</p>
              <div className="flex items-baseline gap-1 mb-8">
                <span className="text-[#3A2332] text-4xl font-semibold tracking-tight">{plan.price}</span>
                <span className="text-[#7A6B63] text-sm">{plan.period}</span>
              </div>
              <ul className="flex flex-col gap-2.5 mb-8 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2.5 text-sm text-[#3A2332]">
                    <span className="w-1 h-1 bg-[#D8B07A] flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                to="/login"
                className={`text-center text-sm font-medium py-2.5 transition-colors ${
                  plan.featured
                    ? 'bg-[#D8B07A] text-[#1A1A2E] hover:bg-[#c9a06a]'
                    : 'border border-[#E8DDD6] text-[#3A2332] bg-white hover:bg-[#F7F1EC]'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

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
