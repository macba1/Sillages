import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';

const PLANS = [
  {
    key: 'starter',
    name: 'Starter',
    price: 0,
    period: 'Free forever',
    description: 'Basic daily brief with yesterday\'s sales summary.',
    features: [
      'Daily brief (basic)',
      'Store dashboard',
      'Basic analytics',
    ],
    cta: 'Start Free',
    highlighted: false,
  },
  {
    key: 'basico',
    name: 'Básico',
    price: 19,
    period: '/month',
    description: 'Full daily brief with trends and recommendations.',
    features: [
      'Everything in Starter',
      'Full intelligence brief',
      'Trends & recommendations',
      'Brand voice customization',
      '14-day free trial',
    ],
    cta: 'Start 14-day trial',
    highlighted: false,
  },
  {
    key: 'crecimiento',
    name: 'Crecimiento',
    price: 39,
    period: '/month',
    description: 'Full brief plus automated cart recovery emails.',
    features: [
      'Everything in Básico',
      'Cart recovery emails',
      'Push notifications',
      '14-day free trial',
    ],
    cta: 'Start 14-day trial',
    highlighted: true,
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 59,
    period: '/month',
    description: 'Full brief, cart recovery, and welcome emails.',
    features: [
      'Everything in Crecimiento',
      'Welcome emails',
      'Priority support',
      '14-day free trial',
    ],
    cta: 'Start 14-day trial',
    highlighted: false,
  },
];

export default function Plans() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isNewInstall = searchParams.get('new_install') === 'true';
  const accountIdParam = searchParams.get('account_id');

  async function handleSelectPlan(planKey: string) {
    setLoading(planKey);
    setError(null);

    try {
      // Pass account_id for new installs (merchant not yet logged in)
      const body: Record<string, string> = { plan: planKey };
      if (accountIdParam) {
        body.account_id = accountIdParam;
      }

      const { data } = await api.post('/api/shopify/billing/subscribe', body);

      if (data.redirect) {
        // Shopify billing approval page
        window.location.href = data.redirect;
      } else {
        // Free plan or billing unavailable — go to dashboard
        // For new installs without session, go to login first
        if (isNewInstall) {
          window.location.href = '/login?plan=' + planKey;
        } else {
          window.location.href = '/dashboard?plan=' + planKey;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
      setLoading(null);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F7F1EC', padding: '40px 20px', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1f2937', margin: 0 }}>
            {isNewInstall ? 'Choose your plan' : 'Plans & Pricing'}
          </h1>
          <p style={{ fontSize: 15, color: '#6b7280', marginTop: 8 }}>
            {isNewInstall
              ? 'Start with a 14-day free trial on any paid plan. Cancel anytime.'
              : 'Upgrade or change your plan at any time.'}
          </p>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', marginBottom: 20, textAlign: 'center', color: '#dc2626', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Plans grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
          {PLANS.map(plan => (
            <div
              key={plan.key}
              style={{
                background: '#fff',
                borderRadius: 12,
                border: plan.highlighted ? '2px solid #C9964A' : '1px solid #e5e7eb',
                padding: '28px 24px',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                boxShadow: plan.highlighted ? '0 4px 20px rgba(201,150,74,0.15)' : '0 1px 3px rgba(0,0,0,0.06)',
              }}
            >
              {plan.highlighted && (
                <div style={{
                  position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                  background: '#C9964A', color: '#fff', fontSize: 10, fontWeight: 700,
                  padding: '3px 12px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  Most Popular
                </div>
              )}

              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>
                {plan.name}
              </h2>

              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 32, fontWeight: 700, color: '#111827' }}>
                  {plan.price === 0 ? '$0' : `$${plan.price}`}
                </span>
                <span style={{ fontSize: 14, color: '#6b7280', marginLeft: 4 }}>
                  {plan.period}
                </span>
              </div>

              <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5, marginBottom: 20, minHeight: 40 }}>
                {plan.description}
              </p>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', flex: 1 }}>
                {plan.features.map(f => (
                  <li key={f} style={{ fontSize: 13, color: '#374151', padding: '5px 0', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ color: '#C9964A', fontSize: 14, lineHeight: 1.3 }}>&#10003;</span>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleSelectPlan(plan.key)}
                disabled={loading !== null}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: 'none',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: loading ? 'wait' : 'pointer',
                  opacity: loading && loading !== plan.key ? 0.5 : 1,
                  background: plan.highlighted ? '#C9964A' : '#1f2937',
                  color: '#fff',
                  transition: 'opacity 0.15s',
                }}
              >
                {loading === plan.key ? 'Redirecting...' : plan.cta}
              </button>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <p style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', marginTop: 32 }}>
          All paid plans include a 14-day free trial. You won't be charged until the trial ends.
          <br />
          Billing is managed securely through Shopify.
        </p>
      </div>
    </div>
  );
}
