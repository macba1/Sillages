import { useGallery, onboardingProgress } from '../../hooks/useGallery';
import { GalleryPage, Card } from '../../components/gallery/GalleryPage';
import { T } from '../../components/gallery/styleTokens';

/**
 * Views, interactions and attributed revenue arrive in Sprint 4. Until the
 * measurement exists this screen says so plainly rather than showing zeros that
 * would read as "nobody looked at it".
 */
export default function Performance() {
  const g = useGallery();
  const progress = onboardingProgress(g.catalog, g.config, g.preview);

  return (
    <GalleryPage
      title="Performance"
      intro="How your gallery is doing: views, interactions, saves, add-to-cart and attributed revenue."
      progress={progress}
      error={g.error}
      onDismissError={g.clearError}
      loading={g.loading}
    >
      <Card>
        <div
          style={{
            display: 'inline-block',
            padding: '6px 12px',
            borderRadius: 999,
            background: 'rgba(201,150,74,0.15)',
            color: '#8A6520',
            fontFamily: T.font,
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          Measurement not switched on yet
        </div>
        <p style={{ margin: 0, fontSize: 14, color: T.body, lineHeight: 1.6 }}>
          Nothing is being measured yet, so this screen shows nothing rather than zeros. Once measurement is on you
          will see what shoppers viewed, which variants they picked, what they saved and shared, what reached the
          cart, and the revenue your gallery is responsible for.
        </p>
        <p style={{ margin: '12px 0 0', fontSize: 13, color: T.muted }}>
          {g.config?.status === 'published'
            ? 'Your gallery is live, so measurement will start collecting as soon as it is switched on.'
            : 'Publish your gallery first — there is nothing to measure until shoppers can see it.'}
        </p>
      </Card>
    </GalleryPage>
  );
}
