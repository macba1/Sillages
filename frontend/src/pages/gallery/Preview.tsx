import { useGallery, onboardingProgress } from '../../hooks/useGallery';
import { GalleryPage, Card } from '../../components/gallery/GalleryPage';
import { GalleryPreviewCanvas } from '../../components/gallery/GalleryPreviewCanvas';
import { T } from '../../components/gallery/styleTokens';
import { STYLE_LABELS } from '../../types/gallery';

/**
 * Step 3: see exactly what a shopper will get, on a phone and on a desktop,
 * before anything reaches the storefront.
 */
export default function Preview() {
  const g = useGallery();
  const progress = onboardingProgress(g.catalog, g.config, g.preview, g.entitlements);
  const source = g.config?.collectionId
    ? g.collections.find((c) => c.id === g.config?.collectionId)?.title ?? 'A collection'
    : 'Every product';

  return (
    <GalleryPage
      title="Preview"
      intro="This is what your storefront will show. Nothing is live until you publish."
      progress={progress}
      error={g.error}
      onDismissError={g.clearError}
      loading={g.loading}
    >
      {g.config && (
        <Card style={{ marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Fact label="Showing" value={source} />
          <Fact label="Look" value={STYLE_LABELS[g.config.style].name} />
          <Fact label="Products in view" value={String(g.preview?.posts.length ?? 0)} />
          <Fact label="Quick buy" value={g.config.showQuickBuy ? 'On' : 'Off'} />
        </Card>
      )}

      <GalleryPreviewCanvas preview={g.preview} />
    </GalleryPage>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.muted }}>{label}</div>
      <div style={{ fontFamily: T.font, fontSize: 15, fontWeight: 600, color: T.ink }}>{value}</div>
    </div>
  );
}
