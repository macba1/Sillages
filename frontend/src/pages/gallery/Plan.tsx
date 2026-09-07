import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { GalleryPage, Card } from '../../components/gallery/GalleryPage';
import { T } from '../../components/gallery/styleTokens';

interface Plan {
  id: string;
  name: string;
  priceUsd: number | null;
  currency: string;
  interval: string;
  status: 'available' | 'coming_soon';
  features: string[];
}

interface PlansResponse {
  billingProvider: string;
  plans: Plan[];
  upcomingPlans: Plan[];
}

const FEATURE_LABELS: Record<string, string> = {
  one_gallery: 'One gallery',
  three_styles: 'Three looks',
  automatic_catalog_sync: 'Automatic catalogue sync',
  shoppable_variants: 'Shoppable variants',
  save_and_share: 'Save and share',
  essential_metrics: 'Essential metrics',
  multiple_galleries: 'Several galleries',
  revenue_attribution: 'Revenue attribution',
  automatic_reordering: 'Automatic reordering',
  design_experiments: 'Design experiments',
  higher_volume: 'Higher volume',
  multiple_storefronts: 'Several storefronts',
  advanced_rules: 'Advanced rules',
  priority_support: 'Priority support',
};

/**
 * Read-only. Plan data comes from the backend so pricing has exactly one source
 * of truth. Subscribing arrives with Shopify Billing in Sprint 6, which is why
 * there is deliberately no checkout button here and no Stripe anywhere.
 */
export default function Plan() {
  const [data, setData] = useState<PlansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PlansResponse>('/api/plans')
      .then((res) => setData(res.data))
      .catch(() => setError('We could not load the plans. Reload the page to try again.'));
  }, []);

  const all = data ? [...data.plans, ...data.upcomingPlans] : [];

  return (
    <GalleryPage
      title="Plan"
      intro="Basic and Growth are the launch plans. Billing runs through Shopify, so it appears on your Shopify invoice."
      error={error}
      loading={!data && !error}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {all.map((plan) => (
          <Card key={plan.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontFamily: T.font, fontWeight: 700, fontSize: 17, color: T.ink }}>{plan.name}</span>
              {plan.priceUsd !== null && (
                <span style={{ fontSize: 14, color: T.body }}>
                  ${plan.priceUsd}/{plan.interval}
                </span>
              )}
            </div>

            {plan.status === 'coming_soon' && (
              <span
                style={{
                  alignSelf: 'flex-start',
                  padding: '2px 10px',
                  borderRadius: 999,
                  background: 'rgba(42,31,20,0.08)',
                  fontSize: 11,
                  fontWeight: 600,
                  color: T.body,
                }}
              >
                Coming soon
              </span>
            )}

            <ul style={{ margin: 0, paddingLeft: 18, color: T.body, fontSize: 13, lineHeight: 1.7 }}>
              {plan.features.map((feature) => (
                <li key={feature}>{FEATURE_LABELS[feature] ?? feature}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <p style={{ marginTop: 20, fontSize: 13, color: T.muted }}>
        Changing plan is not available yet. It arrives with billing.
      </p>
    </GalleryPage>
  );
}
