import { useGallery, onboardingProgress } from '../../hooks/useGallery';
import { GalleryPage, Button, Card } from '../../components/gallery/GalleryPage';
import { T } from '../../components/gallery/styleTokens';

/**
 * Step 1 of the onboarding: what goes in the gallery.
 *
 * Also the catalogue's status panel, because "is my catalogue current?" is the
 * question a merchant asks here.
 */
export default function Collections() {
  const g = useGallery();
  const progress = onboardingProgress(g.catalog, g.config, g.preview);
  const selected = g.config?.collectionId ?? null;

  return (
    <GalleryPage
      title="Collections"
      intro="Choose what your gallery shows. Your Shopify catalogue stays in sync automatically — nothing to upload and nothing to tag."
      progress={progress}
      error={g.error}
      onDismissError={g.clearError}
      loading={g.loading}
      actions={
        g.catalog?.connected ? (
          <Button variant="secondary" onClick={() => void g.sync()} disabled={g.busy}>
            {g.busy ? 'Syncing…' : 'Sync now'}
          </Button>
        ) : null
      }
    >
      {!g.catalog?.connected && (
        <Card>
          <p style={{ margin: 0, color: T.body, fontSize: 14 }}>
            No Shopify store is connected yet. Connect one and your catalogue will import automatically.
          </p>
        </Card>
      )}

      {g.catalog?.connected && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            <Stat label="Products" value={String(g.catalog.productCount)} />
            <Stat label="Collections" value={String(g.catalog.collectionCount)} />
            <Stat label="Last sync" value={describeSync(g.catalog.lastSync)} />
          </div>

          {g.catalog.lastSync?.status === 'failed' && g.catalog.lastSync.error && (
            <p style={{ color: T.danger, fontSize: 13, marginTop: -8, marginBottom: 20 }}>
              The last sync failed: {g.catalog.lastSync.error}
            </p>
          )}

          <h2 style={{ fontFamily: T.font, fontSize: 16, fontWeight: 600, color: T.ink, marginBottom: 10 }}>
            What should the gallery show?
          </h2>

          <div role="radiogroup" aria-label="Gallery source" style={{ display: 'grid', gap: 8 }}>
            <SourceOption
              checked={selected === null}
              title="Every product"
              detail={`${g.catalog.productCount} products`}
              onSelect={() => void g.save({ collectionId: null })}
              disabled={g.busy}
            />
            {g.collections.map((collection) => (
              <SourceOption
                key={collection.id}
                checked={selected === collection.id}
                title={collection.title}
                detail={`${collection.productsCount ?? 0} products`}
                onSelect={() => void g.save({ collectionId: collection.id })}
                disabled={g.busy}
              />
            ))}
          </div>

          {g.collections.length === 0 && (
            <p style={{ color: T.body, fontSize: 14, marginTop: 12 }}>
              No collections imported yet. You can still publish a gallery with every product.
            </p>
          )}
        </>
      )}
    </GalleryPage>
  );
}

function SourceOption({
  checked,
  title,
  detail,
  onSelect,
  disabled,
}: {
  checked: boolean;
  title: string;
  detail: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minHeight: 52,
        padding: '12px 16px',
        border: `1px solid ${checked ? T.ink : T.line}`,
        borderRadius: 12,
        background: checked ? 'rgba(201,150,74,0.10)' : T.surface,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <input
        type="radio"
        name="gallery-source"
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        style={{ accentColor: T.gold, width: 18, height: 18 }}
      />
      <span style={{ flex: 1, fontFamily: T.font, fontWeight: checked ? 600 : 500, fontSize: 14, color: T.ink }}>
        {title}
      </span>
      <span style={{ fontSize: 13, color: T.muted }}>{detail}</span>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ minWidth: 130, padding: '12px 16px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.muted }}>{label}</div>
      <div style={{ fontFamily: T.font, fontSize: 18, fontWeight: 700, color: T.ink }}>{value}</div>
    </Card>
  );
}

function describeSync(
  lastSync: { status: string; stale?: boolean; startedAt: string; finishedAt: string | null } | null,
): string {
  if (!lastSync) return 'Never';
  // "In progress" is only ever shown for a run that is genuinely still
  // reporting. One that stopped is reported as stopped.
  if (lastSync.stale) return 'Stopped';
  if (lastSync.status === 'running') return 'In progress';
  if (lastSync.status === 'failed') return 'Failed';
  return new Date(lastSync.finishedAt ?? lastSync.startedAt).toLocaleString();
}
