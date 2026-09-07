import { useCallback, useEffect, useState } from 'react';
import api from '../../lib/api';
import { GalleryPage, Button, Card } from '../../components/gallery/GalleryPage';
import { T } from '../../components/gallery/styleTokens';

interface Plan {
  id: string;
  name: string;
  priceUsd: number | null;
  currency: string;
  interval: string;
  status: 'available' | 'coming_soon';
  trialDays: number;
  features: string[];
}

interface Subscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
  planId: string | null;
}

interface SubscriptionResponse {
  connected: boolean;
  plans: Plan[];
  subscription: Subscription | null;
  unreachable?: boolean;
  live: boolean;
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
 * Billing runs through Shopify, so a charge appears on the merchant's Shopify
 * invoice. Until the app is reviewed and billing is deliberately switched live,
 * every subscription Shopify creates here is a test charge — and the screen
 * says so rather than letting someone believe they have paid.
 */
export default function Plan() {
  const [data, setData] = useState<SubscriptionResponse | null>(null);
  const [upcoming, setUpcoming] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [subscription, plans] = await Promise.all([
        api.get<SubscriptionResponse>('/api/subscription'),
        api.get<PlansResponse>('/api/plans'),
      ]);
      setData(subscription.data);
      setUpcoming(plans.data.upcomingPlans);
      setError(null);
    } catch {
      setError('We could not load your plan. Reload the page to try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function choose(planId: string) {
    setBusy(planId);
    setError(null);
    try {
      const res = await api.post<{ confirmationUrl: string }>('/api/subscription', { plan: planId });
      window.location.href = res.data.confirmationUrl;
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      setError(message ?? 'We could not start that plan. Try again in a moment.');
      setBusy(null);
    }
  }

  const current = data?.subscription;
  const all = [...(data?.plans ?? []), ...upcoming];

  return (
    <GalleryPage
      title="Plan"
      intro="Basic and Growth include a 14-day free trial. Billing runs through Shopify, so it appears on your Shopify invoice."
      error={error}
      loading={loading}
    >
      {data && !data.live && (
        <Card style={{ marginBottom: 20, borderColor: 'rgba(201,150,74,0.5)' }}>
          <p style={{ margin: 0, fontSize: 14, color: T.body, lineHeight: 1.6 }}>
            <strong>Billing is in test mode.</strong> Choosing a plan creates a Shopify <em>test</em> charge: you will
            not be billed, and nothing is taken from your account. Real billing is switched on once Sillages is
            approved in the Shopify App Store.
          </p>
        </Card>
      )}

      {data?.unreachable && (
        <Card style={{ marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 14, color: T.body }}>
            We could not reach Shopify to check your subscription, so your current plan is not shown. Your store is
            unaffected.
          </p>
        </Card>
      )}

      {current && (
        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '6px 14px',
                borderRadius: 999,
                background: 'rgba(46,122,74,0.14)',
                color: '#2E7A4A',
                fontFamily: T.font,
                fontWeight: 700,
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {current.status === 'ACTIVE' ? 'Active' : current.status}
            </span>
            <span style={{ flex: 1, fontFamily: T.font, fontWeight: 600, fontSize: 15, color: T.ink, minWidth: 180 }}>
              {current.name}
              {current.test && <span style={{ color: T.muted, fontWeight: 400 }}> · test charge</span>}
            </span>
            {current.currentPeriodEnd && (
              <span style={{ fontSize: 13, color: T.muted }}>
                Renews {new Date(current.currentPeriodEnd).toLocaleDateString()}
              </span>
            )}
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {all.map((plan) => {
          const isCurrent = current?.planId === plan.id;
          const buyable = plan.status === 'available' && plan.priceUsd !== null && !isCurrent;

          return (
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

              <ul style={{ margin: 0, paddingLeft: 18, color: T.body, fontSize: 13, lineHeight: 1.7, flex: 1 }}>
                {plan.features.map((feature) => (
                  <li key={feature}>{FEATURE_LABELS[feature] ?? feature}</li>
                ))}
              </ul>

              {plan.trialDays > 0 && plan.status === 'available' && (
                <p style={{ margin: 0, fontSize: 12, color: T.muted }}>{plan.trialDays}-day free trial</p>
              )}

              {isCurrent ? (
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#2E7A4A' }}>Your current plan</p>
              ) : buyable ? (
                <Button onClick={() => void choose(plan.id)} disabled={busy !== null}>
                  {busy === plan.id ? 'Opening Shopify…' : `Choose ${plan.name}`}
                </Button>
              ) : null}
            </Card>
          );
        })}
      </div>

      <p style={{ marginTop: 20, fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
        You approve every charge in Shopify before it starts, and you can cancel from your Shopify admin at any time.
        Cancelling turns the gallery off; your store is left exactly as it was.
      </p>
    </GalleryPage>
  );
}
