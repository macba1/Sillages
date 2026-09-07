import { useCallback, useEffect, useState } from 'react';
import api from '../../lib/api';
import { useGallery, onboardingProgress } from '../../hooks/useGallery';
import { GalleryPage, Card } from '../../components/gallery/GalleryPage';
import { T } from '../../components/gallery/styleTokens';
import type { PerformanceResponse } from '../../types/gallery';

const RANGES = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
] as const;

/**
 * What the gallery did: the journey from looking to buying, and the revenue it
 * is credited with.
 *
 * Every number here is an aggregate. Nothing on this screen identifies a
 * shopper, because nothing about a shopper is collected.
 */
export default function Performance() {
  const g = useGallery();
  const progress = onboardingProgress(g.catalog, g.config, g.preview, g.entitlements);

  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (selected: string) => {
    setLoading(true);
    try {
      const res = await api.get<PerformanceResponse>(`/api/performance?range=${selected}`);
      setData(res.data);
      setError(null);
    } catch {
      setError('We could not load your numbers. Reload the page to try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  const totals = data?.totals;
  const nothingYet = !totals || totals.galleryViews === 0;
  const money = (value: number) => (totals?.currency ? `${value.toFixed(2)} ${totals.currency}` : value.toFixed(2));

  return (
    <GalleryPage
      title="Performance"
      intro="What shoppers did with your gallery, and the revenue it is credited with."
      progress={progress}
      error={error ?? g.error}
      onDismissError={g.clearError}
      loading={loading && !data}
      actions={
        <div role="group" aria-label="Date range" style={{ display: 'flex', gap: 6 }}>
          {RANGES.map((option) => (
            <button
              key={option.key}
              onClick={() => setRange(option.key)}
              aria-pressed={range === option.key}
              style={{
                padding: '8px 12px',
                minHeight: 40,
                borderRadius: 999,
                border: `1px solid ${range === option.key ? T.ink : T.line}`,
                background: range === option.key ? 'rgba(201,150,74,0.16)' : 'transparent',
                color: T.ink,
                fontFamily: T.font,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      }
    >
      {data && !data.measuring && (
        <Card style={{ marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 14, color: T.body, lineHeight: 1.6 }}>
            Your gallery is not published, so there is nothing to measure yet. Publish it and numbers will start
            appearing here.
          </p>
        </Card>
      )}

      {data?.measuring && nothingYet && (
        <Card style={{ marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 14, color: T.body, lineHeight: 1.6 }}>
            No activity in this period yet. It can take a little while after publishing before shoppers reach the
            gallery.
          </p>
        </Card>
      )}

      {data?.approximate && (
        <Card style={{ marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 13, color: T.body }}>
            These counts are approximate: the reporting tables are still being set up. They will be exact shortly.
          </p>
        </Card>
      )}

      {data?.measurement && data.measurement.gallery && !data.measurement.checkout && (
        <Card style={{ marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 14, color: T.body, lineHeight: 1.6 }}>
            <strong>Checkout and purchases are not being measured yet.</strong> Everything below covers what shoppers
            did inside the gallery. Orders and revenue need the Sillages storefront pixel, which is not switched on
            for your store — so "Orders credited" and "Revenue credited" will stay at zero until it is. That is a
            missing measurement, not a sign that nobody bought anything.
          </p>
        </Card>
      )}

      {totals && !nothingYet && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            <Stat label="Shoppers" value={String(totals.sessions)} />
            <Stat label="Added to cart" value={String(totals.addToCarts)} />
            <Stat label="Orders credited" value={String(totals.attributedOrders)} />
            <Stat label="Revenue credited" value={money(totals.attributedRevenue)} />
          </div>

          <h2 style={{ fontFamily: T.font, fontSize: 16, fontWeight: 600, color: T.ink, marginBottom: 10 }}>
            From looking to buying
          </h2>
          <Card style={{ marginBottom: 24 }}>
            {data.funnel.map((step) => {
              const top = data.funnel[0].count || 1;
              const share = Math.min(100, Math.round((step.count / top) * 100));
              return (
                <div key={step.step} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: T.body, marginBottom: 4 }}>
                    <span>{step.step}</span>
                    <span style={{ fontWeight: 600, color: T.ink }}>{step.count}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: 'rgba(42,31,20,0.07)', overflow: 'hidden' }}>
                    <div
                      style={{ width: `${share}%`, height: '100%', background: T.gold }}
                      role="presentation"
                    />
                  </div>
                </div>
              );
            })}
          </Card>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            <Stat label="Saved" value={String(totals.saves)} />
            <Stat label="Shared" value={String(totals.shares)} />
            <Stat label="Variants chosen" value={String(totals.variantSelects)} />
          </div>

          {data.topProducts.length > 0 && (
            <>
              <h2 style={{ fontFamily: T.font, fontSize: 16, fontWeight: 600, color: T.ink, marginBottom: 10 }}>
                Most added to cart
              </h2>
              <div style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
                {data.topProducts.map((product) => {
                  const post = g.preview?.posts.find((p) => p.id === product.productId);
                  return (
                    <Card key={product.productId} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span style={{ flex: 1, fontSize: 14, color: T.ink, fontFamily: T.font, fontWeight: 500 }}>
                        {post?.title ?? `Product ${product.productId}`}
                      </span>
                      <span style={{ fontSize: 13, color: T.muted }}>{product.opens} opened</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{product.addToCarts} added</span>
                    </Card>
                  );
                })}
              </div>
            </>
          )}

          <p style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, margin: 0 }}>
            Orders are credited to the gallery when a shopper who used it goes on to buy — exactly, when the cart
            carried the gallery session, or by matching a purchased variant they interacted with in the previous
            seven days. Revenue is reported by the storefront pixel and is not read from your Shopify orders, so
            treat it as an indication rather than as your accounts. Nothing here identifies a shopper.
          </p>
        </>
      )}
    </GalleryPage>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ minWidth: 140, padding: '12px 16px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.muted }}>{label}</div>
      <div style={{ fontFamily: T.font, fontSize: 20, fontWeight: 700, color: T.ink }}>{value}</div>
    </Card>
  );
}
