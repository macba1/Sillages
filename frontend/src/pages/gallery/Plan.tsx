import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { GalleryPlaceholder } from './Placeholder';

interface Plan {
  id: string;
  name: string;
  priceUsd: number | null;
  currency: string;
  interval: string;
  status: 'available' | 'coming_soon';
}

interface PlansResponse {
  billingProvider: string;
  plans: Plan[];
  upcomingPlans: Plan[];
}

/**
 * Sprint 0: read-only. Plan data comes from the backend
 * (`GET /api/plans` → `config/socialGalleryPlans.ts`) so pricing has exactly one
 * source of truth. Subscribing is wired up with Shopify Billing in Sprint 6 —
 * there is deliberately no checkout button here, and no Stripe.
 */
export default function Plan() {
  const [data, setData] = useState<PlansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PlansResponse>('/api/plans')
      .then((res) => setData(res.data))
      .catch(() => setError('Could not load plans.'));
  }, []);

  return (
    <GalleryPlaceholder
      title="Plan"
      description="Basic and Growth are the launch plans. Billing runs through Shopify Billing."
      sprint="Sprint 6 (billing)"
    >
      <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <p style={{ color: '#8A2E2E', fontSize: 14 }}>{error}</p>}
        {!data && !error && <p style={{ color: '#5C4B38', fontSize: 14 }}>Loading plans…</p>}
        {data &&
          [...data.plans, ...data.upcomingPlans].map((plan) => (
            <div
              key={plan.id}
              style={{
                border: '1px solid rgba(42,31,20,0.12)',
                borderRadius: 12,
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                background: '#FFFDFA',
              }}
            >
              <span
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 600,
                  fontSize: 15,
                  color: '#2A1F14',
                }}
              >
                {plan.name}
              </span>
              <span style={{ fontSize: 14, color: '#5C4B38' }}>
                {plan.priceUsd !== null && `$${plan.priceUsd}/${plan.interval}`}
                {plan.status === 'coming_soon' && (
                  <span
                    style={{
                      marginLeft: plan.priceUsd !== null ? 8 : 0,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: 'rgba(42,31,20,0.08)',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#5C4B38',
                    }}
                  >
                    Coming soon
                  </span>
                )}
              </span>
            </div>
          ))}
      </div>
    </GalleryPlaceholder>
  );
}
