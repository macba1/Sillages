import { useEffect, useState } from 'react';
import { useGallery, onboardingProgress } from '../../hooks/useGallery';
import { GalleryPage, Button, Card } from '../../components/gallery/GalleryPage';
import { GalleryPreviewCanvas } from '../../components/gallery/GalleryPreviewCanvas';
import { STYLE_TOKENS, T } from '../../components/gallery/styleTokens';
import { GALLERY_STYLES, STYLE_LABELS, type GalleryStyle } from '../../types/gallery';

/**
 * Step 2: pick a look. Each option shows the merchant's own photos, so the
 * choice is made on real content rather than on a stock mockup.
 */
export default function Design() {
  const g = useGallery();
  const progress = onboardingProgress(g.catalog, g.config, g.preview, g.entitlements);

  const [heading, setHeading] = useState('');
  const [headingDirty, setHeadingDirty] = useState(false);

  useEffect(() => {
    if (!headingDirty) setHeading(g.config?.heading ?? '');
  }, [g.config?.heading, headingDirty]);

  const sampleImage = g.preview?.posts.find((p) => p.image?.url)?.image?.url ?? null;

  return (
    <GalleryPage
      title="Design"
      intro="Pick how your gallery looks. There is no editor to learn — choose one and move on."
      progress={progress}
      error={g.error}
      onDismissError={g.clearError}
      loading={g.loading}
    >
      <div
        role="radiogroup"
        aria-label="Gallery style"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}
      >
        {GALLERY_STYLES.map((style) => (
          <StyleOption
            key={style}
            style={style}
            image={sampleImage}
            selected={g.config?.style === style}
            disabled={g.busy}
            onSelect={() => void g.save({ style })}
          />
        ))}
      </div>

      <Card style={{ marginBottom: 28 }}>
        <label htmlFor="gallery-heading" style={{ display: 'block', fontFamily: T.font, fontWeight: 600, fontSize: 14, color: T.ink, marginBottom: 6 }}>
          Heading above the gallery
        </label>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: T.muted }}>Optional. Leave it empty for no heading.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            id="gallery-heading"
            value={heading}
            maxLength={120}
            placeholder="Shop the look"
            onChange={(e) => {
              setHeading(e.target.value);
              setHeadingDirty(true);
            }}
            style={{
              flex: '1 1 240px',
              minHeight: 44,
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${T.line}`,
              fontSize: 14,
              fontFamily: T.font,
              color: T.ink,
            }}
          />
          <Button
            disabled={g.busy || !headingDirty}
            onClick={async () => {
              const ok = await g.save({ heading: heading.trim() || null });
              if (ok) setHeadingDirty(false);
            }}
          >
            Save heading
          </Button>
        </div>
      </Card>

      <Card style={{ marginBottom: 28 }}>
        <Toggle
          label="Show collections as stories"
          detail="A row of circles above the grid, like a social feed."
          checked={g.config?.showStories ?? true}
          disabled={g.busy}
          onChange={(value) => void g.save({ showStories: value })}
        />
        <div style={{ height: 1, background: T.line, margin: '14px 0' }} />
        <Toggle
          label="Let shoppers buy from the gallery"
          detail="Adds a variant picker and an add-to-cart button. Turn it off to link to the product page instead."
          checked={g.config?.showQuickBuy ?? true}
          disabled={g.busy}
          onChange={(value) => void g.save({ showQuickBuy: value })}
        />
      </Card>

      <h2 style={{ fontFamily: T.font, fontSize: 16, fontWeight: 600, color: T.ink, marginBottom: 12 }}>
        How it looks
      </h2>
      <GalleryPreviewCanvas preview={g.preview} maxPosts={8} />
    </GalleryPage>
  );
}

function StyleOption({
  style,
  image,
  selected,
  disabled,
  onSelect,
}: {
  style: GalleryStyle;
  image: string | null;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const tokens = STYLE_TOKENS[style];
  const label = STYLE_LABELS[style];

  return (
    <label
      style={{
        display: 'block',
        border: `1px solid ${selected ? T.ink : T.line}`,
        borderRadius: 12,
        padding: 12,
        background: selected ? 'rgba(201,150,74,0.10)' : T.surface,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <div
        style={{
          aspectRatio: '1 / 1',
          borderRadius: tokens.radius,
          overflow: 'hidden',
          background: tokens.cardBg === 'transparent' ? 'rgba(42,31,20,0.06)' : tokens.cardBg,
          padding: tokens.pad,
          marginBottom: 10,
        }}
      >
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', filter: tokens.filter, display: 'block', borderRadius: Math.max(2, tokens.radius - 2) }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', background: 'rgba(42,31,20,0.06)' }} />
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="radio"
          name="gallery-style"
          checked={selected}
          onChange={onSelect}
          disabled={disabled}
          style={{ accentColor: T.gold, width: 18, height: 18 }}
        />
        <span style={{ fontFamily: T.font, fontWeight: 600, fontSize: 14, color: T.ink }}>{label.name}</span>
      </div>
      <p style={{ margin: '6px 0 0 26px', fontSize: 12, color: T.muted, lineHeight: 1.4 }}>{label.description}</p>
    </label>
  );
}

function Toggle({
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: disabled ? 'default' : 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: T.gold, width: 18, height: 18, marginTop: 2 }}
      />
      <span>
        <span style={{ display: 'block', fontFamily: T.font, fontWeight: 600, fontSize: 14, color: T.ink }}>{label}</span>
        <span style={{ display: 'block', fontSize: 13, color: T.muted, marginTop: 2, lineHeight: 1.4 }}>{detail}</span>
      </span>
    </label>
  );
}
