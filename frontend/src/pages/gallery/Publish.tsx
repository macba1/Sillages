import { useGallery, onboardingProgress } from '../../hooks/useGallery';
import { GalleryPage, Button, Card } from '../../components/gallery/GalleryPage';
import { T } from '../../components/gallery/styleTokens';
import { STYLE_LABELS } from '../../types/gallery';

/**
 * Step 4: go live, turn it off, or go back to a version that worked.
 *
 * Publishing is one click. The one thing Sillages cannot do for the merchant is
 * place the block in their theme, so that instruction is stated plainly here
 * rather than left for support to explain.
 */
export default function Publish() {
  const g = useGallery();
  const progress = onboardingProgress(g.catalog, g.config, g.preview);
  const config = g.config;
  const status = config?.status ?? 'draft';
  const nothingToShow = (g.preview?.posts.length ?? 0) === 0;

  return (
    <GalleryPage
      title="Publish"
      intro="Turn your gallery on, turn it off, or go back to a previous version. Turning it off leaves your store exactly as it was."
      progress={progress}
      error={g.error}
      onDismissError={g.clearError}
      loading={g.loading}
    >
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusBadge status={status} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: T.font, fontWeight: 600, fontSize: 15, color: T.ink }}>
              {status === 'published'
                ? `Live on your store — version ${config?.version}`
                : status === 'disabled'
                  ? 'Turned off'
                  : 'Not published yet'}
            </div>
            <div style={{ fontSize: 13, color: T.muted, marginTop: 2 }}>
              {config
                ? `${STYLE_LABELS[config.style].name} · ${g.preview?.posts.length ?? 0} products`
                : 'Choose a collection and a look first.'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {status !== 'published' && (
              <Button onClick={() => void g.publish()} disabled={g.busy || nothingToShow}>
                {g.busy ? 'Working…' : 'Publish'}
              </Button>
            )}
            {status === 'published' && (
              <>
                <Button variant="secondary" onClick={() => void g.publish()} disabled={g.busy}>
                  Republish changes
                </Button>
                <Button variant="danger" onClick={() => void g.disable()} disabled={g.busy}>
                  Turn off
                </Button>
              </>
            )}
          </div>
        </div>

        {nothingToShow && (
          <p style={{ margin: '12px 0 0', fontSize: 13, color: T.danger }}>
            There is nothing to publish yet. Sync your catalogue, or pick a collection that has products.
          </p>
        )}
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: T.font, fontSize: 15, fontWeight: 600, color: T.ink, margin: '0 0 8px' }}>
          One-time step in your theme
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: T.body, lineHeight: 1.6 }}>
          Open your Shopify admin → <strong>Online Store</strong> → <strong>Themes</strong> →{' '}
          <strong>Customise</strong>, then <strong>Add block</strong> → <strong>Sillages social gallery</strong> where
          you want the gallery to appear, and save. You only do this once. Your theme code is never edited, and
          removing the block removes the gallery completely.
        </p>
      </Card>

      <h2 style={{ fontFamily: T.font, fontSize: 16, fontWeight: 600, color: T.ink, marginBottom: 10 }}>
        Previous versions
      </h2>

      {g.versions.length === 0 ? (
        <p style={{ color: T.body, fontSize: 14 }}>Nothing published yet, so there is nothing to go back to.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {g.versions.map((version) => (
            <Card
              key={version.version}
              style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <span style={{ fontFamily: T.font, fontWeight: 600, fontSize: 14, color: T.ink, minWidth: 90 }}>
                Version {version.version}
              </span>
              <span style={{ flex: 1, fontSize: 13, color: T.muted, minWidth: 160 }}>
                {STYLE_LABELS[version.snapshot.style]?.name ?? version.snapshot.style}
                {version.snapshot.heading ? ` · “${version.snapshot.heading}”` : ''}
                {' · '}
                {new Date(version.publishedAt).toLocaleString()}
              </span>
              {version.version !== config?.version && (
                <Button variant="secondary" onClick={() => void g.revert(version.version)} disabled={g.busy}>
                  Restore
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </GalleryPage>
  );
}

function StatusBadge({ status }: { status: 'draft' | 'published' | 'disabled' }) {
  const palette =
    status === 'published'
      ? { bg: 'rgba(46,122,74,0.14)', fg: '#2E7A4A', label: 'Live' }
      : status === 'disabled'
        ? { bg: 'rgba(138,46,46,0.12)', fg: T.danger, label: 'Off' }
        : { bg: 'rgba(42,31,20,0.08)', fg: T.muted, label: 'Draft' };

  return (
    <span
      style={{
        padding: '6px 14px',
        borderRadius: 999,
        background: palette.bg,
        color: palette.fg,
        fontFamily: T.font,
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}
    >
      {palette.label}
    </span>
  );
}
