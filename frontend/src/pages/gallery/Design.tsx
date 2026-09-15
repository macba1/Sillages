import { useEffect, useState } from 'react';
import { useGallery, onboardingProgress } from '../../hooks/useGallery';
import { GalleryPage, Button, Card } from '../../components/gallery/GalleryPage';
import { GalleryPreviewCanvas } from '../../components/gallery/GalleryPreviewCanvas';
import { FRAME_COPY, LAYOUT_COPY, STYLE_COPY, T, filterFor, frameStyle } from '../../components/gallery/styleTokens';
import {
  GALLERY_FRAMES,
  GALLERY_LAYOUTS,
  GALLERY_STYLES,
  type GalleryLayout,
} from '../../types/gallery';

/**
 * Step 2: pick a look.
 *
 * Three separate decisions — arrangement, treatment, border — each previewed on
 * the merchant's own photographs, because a choice made on a stock mockup is
 * not a choice about their shop. Nothing here is an editor: every option is one
 * tap and takes effect in the preview underneath.
 */
export default function Design() {
  const g = useGallery();
  const progress = onboardingProgress(g.catalog, g.config, g.preview, g.entitlements);

  const [heading, setHeading] = useState('');
  const [headingDirty, setHeadingDirty] = useState(false);
  const [tagline, setTagline] = useState('');
  const [taglineDirty, setTaglineDirty] = useState(false);
  // Held locally while dragging so the preview moves with the thumb instead of
  // waiting on a round trip for every pixel.
  const [intensity, setIntensity] = useState<number | null>(null);

  useEffect(() => {
    if (!headingDirty) setHeading(g.config?.heading ?? '');
  }, [g.config?.heading, headingDirty]);

  useEffect(() => {
    if (!taglineDirty) setTagline(g.config?.shareTagline ?? '');
  }, [g.config?.shareTagline, taglineDirty]);

  const sampleImage = g.preview?.posts.find((p) => p.image?.url)?.image?.url ?? null;
  const style = g.config?.style ?? 'original';
  const liveIntensity = intensity ?? g.config?.filterIntensity ?? 100;
  // Unknown entitlements fall back to the smallest set, not the largest. A
  // merchant offered a treatment the server will refuse picks it, sees nothing
  // change, and concludes the product is broken.
  const allowedStyles = g.entitlements?.allowedStyles ?? (['original', 'warm', 'film'] as const);
  const allowedFrames = g.entitlements?.allowedFrames ?? (['none', 'clean'] as const);

  // The preview follows the slider before the save lands.
  const preview = g.preview ? { ...g.preview, filterIntensity: liveIntensity } : null;

  return (
    <GalleryPage
      title="Design"
      intro="Pick how your gallery looks. There is no editor to learn — choose one and move on."
      progress={progress}
      error={g.error}
      onDismissError={g.clearError}
      loading={g.loading}
    >
      <Section title="Arrangement" hint="How the products sit on the page.">
        <div
          role="radiogroup"
          aria-label="Gallery layout"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}
        >
          {GALLERY_LAYOUTS.map((layout) => (
            <LayoutOption
              key={layout}
              layout={layout}
              image={sampleImage}
              selected={(g.config?.layout ?? 'grid') === layout}
              disabled={g.busy}
              onSelect={() => void g.save({ layout })}
            />
          ))}
        </div>
      </Section>

      <Section title="Treatment" hint="Applied to how the photographs are shown. Your files in Shopify are never changed.">
        <div
          role="radiogroup"
          aria-label="Photo treatment"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}
        >
          {GALLERY_STYLES.map((option) => (
            <SwatchOption
              key={option}
              name={STYLE_COPY[option].name}
              blurb={STYLE_COPY[option].blurb}
              image={sampleImage}
              imageStyle={{ filter: filterFor(option, liveIntensity) }}
              selected={style === option}
              locked={!(allowedStyles as readonly string[]).includes(option)}
              disabled={g.busy}
              group="gallery-style"
              onSelect={() => void g.save({ style: option })}
            />
          ))}
        </div>

        <div style={{ marginTop: 18 }}>
          <label
            htmlFor="filter-intensity"
            style={{ display: 'flex', justifyContent: 'space-between', fontFamily: T.font, fontSize: 14, fontWeight: 600, color: T.ink }}
          >
            <span aria-hidden>Strength</span>
            <span style={{ fontWeight: 400, color: T.muted }}>{liveIntensity}%</span>
          </label>
          <input
            id="filter-intensity"
            aria-label="Strength"
            type="range"
            min={0}
            max={100}
            step={5}
            value={liveIntensity}
            disabled={g.busy || style === 'original'}
            onChange={(e) => setIntensity(Number(e.target.value))}
            onPointerUp={() => {
              if (intensity !== null && intensity !== g.config?.filterIntensity) {
                void g.save({ filterIntensity: intensity });
              }
            }}
            onKeyUp={() => {
              if (intensity !== null && intensity !== g.config?.filterIntensity) {
                void g.save({ filterIntensity: intensity });
              }
            }}
            style={{ width: '100%', accentColor: T.gold, marginTop: 8 }}
          />
          <p style={{ margin: '6px 0 0', fontSize: 13, color: T.muted }}>
            {style === 'original'
              ? 'Original has nothing to dial down — pick a treatment first.'
              : 'Slide to nothing and the photographs are exactly as you uploaded them.'}
          </p>
        </div>
      </Section>

      <Section title="Border" hint="Drawn around each photograph, never over it.">
        <div
          role="radiogroup"
          aria-label="Frame"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}
        >
          {GALLERY_FRAMES.map((frame) => (
            <SwatchOption
              key={frame}
              name={FRAME_COPY[frame].name}
              blurb={FRAME_COPY[frame].blurb}
              image={sampleImage}
              imageStyle={{ filter: filterFor(style, liveIntensity) }}
              wrapperStyle={frameStyle(frame)}
              selected={(g.config?.frame ?? 'none') === frame}
              locked={!(allowedFrames as readonly string[]).includes(frame)}
              disabled={g.busy}
              group="gallery-frame"
              onSelect={() => void g.save({ frame })}
            />
          ))}
        </div>
      </Section>

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
            style={inputStyle}
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
        <label htmlFor="share-tagline" style={{ display: 'block', fontFamily: T.font, fontWeight: 600, fontSize: 14, color: T.ink, marginBottom: 6 }}>
          Words on the shareable card
        </label>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: T.muted }}>
          When a shopper shares a product, Sillages draws a tall card from your photograph. This line sits under the
          price. Leave it empty for “Shop this look”.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            id="share-tagline"
            value={tagline}
            maxLength={40}
            placeholder="Shop this look"
            onChange={(e) => {
              setTagline(e.target.value);
              setTaglineDirty(true);
            }}
            style={inputStyle}
          />
          <Button
            disabled={g.busy || !taglineDirty}
            onClick={async () => {
              const ok = await g.save({ shareTagline: tagline.trim() || null });
              if (ok) setTaglineDirty(false);
            }}
          >
            Save wording
          </Button>
        </div>

        {g.entitlements?.canRemoveBranding && (
          <>
            <div style={{ height: 1, background: T.line, margin: '14px 0' }} />
            <Toggle
              label="Remove the Sillages mark"
              detail="Takes the small line off the bottom of the shareable card."
              checked={g.config?.hideBranding ?? false}
              disabled={g.busy}
              onChange={(value) => void g.save({ hideBranding: value })}
            />
          </>
        )}
      </Card>

      <Card style={{ marginBottom: 28 }}>
        <Toggle
          label="Show collections as stories"
          detail="A row of circles above the grid. Tapping one opens it full screen."
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
      <GalleryPreviewCanvas preview={preview} maxPosts={9} />
    </GalleryPage>
  );
}

const inputStyle: React.CSSProperties = {
  flex: '1 1 240px',
  minHeight: 44,
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${T.line}`,
  fontSize: 14,
  fontFamily: T.font,
  color: T.ink,
};

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <h2 style={{ fontFamily: T.font, fontSize: 16, fontWeight: 600, color: T.ink, margin: '0 0 4px' }}>{title}</h2>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: T.muted }}>{hint}</p>
      {children}
    </section>
  );
}

/** The arrangement, shown as the shape it makes rather than as a word. */
function LayoutOption({
  layout,
  image,
  selected,
  disabled,
  onSelect,
}: {
  layout: GalleryLayout;
  image: string | null;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const copy = LAYOUT_COPY[layout];
  const cell = (extra: React.CSSProperties = {}) => (
    <span
      style={{
        display: 'block',
        background: image ? undefined : 'rgba(42,31,20,0.10)',
        backgroundImage: image ? `url(${image})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        borderRadius: 3,
        ...extra,
      }}
    />
  );

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
      <div style={{ aspectRatio: '4 / 3', background: '#fff', borderRadius: 8, padding: 8, marginBottom: 10, overflow: 'hidden' }}>
        {layout === 'grid' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, height: '100%' }}>
            {[0, 1, 2, 3].map((i) => cell({ height: '100%', key: i } as React.CSSProperties))}
          </div>
        )}
        {layout === 'polaroid' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, height: '100%', alignItems: 'start' }}>
            {[[-2, 34], [1.5, 46], [1, 44], [-1.5, 32]].map(([deg, h], i) => (
              <span key={i} style={{ display: 'block', background: '#fff', padding: '3px 3px 8px', boxShadow: '0 1px 3px rgba(0,0,0,0.18)', transform: `rotate(${deg}deg)` }}>
                {cell({ height: h })}
              </span>
            ))}
          </div>
        )}
        {layout === 'feed' && (
          <div style={{ display: 'grid', gap: 5, height: '100%' }}>
            {cell({ height: '62%' })}
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: 'rgba(42,31,20,0.25)' }} />
              <span style={{ width: 10, height: 10, borderRadius: 999, background: 'rgba(42,31,20,0.18)' }} />
              <span style={{ marginLeft: 'auto', width: 34, height: 10, borderRadius: 999, background: 'rgba(42,31,20,0.25)' }} />
            </span>
          </div>
        )}
        {layout === 'stories' && (
          <div style={{ display: 'grid', gap: 6, height: '100%' }}>
            <span style={{ display: 'flex', gap: 5 }}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(42,31,20,0.10)', boxShadow: '0 0 0 1.5px rgba(42,31,20,0.35)' }} />
              ))}
            </span>
            <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, flex: 1 }}>
              {[0, 1, 2].map((i) => cell({ height: '100%', key: i } as React.CSSProperties))}
            </span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="radio"
          name="gallery-layout"
          checked={selected}
          onChange={onSelect}
          disabled={disabled}
          style={{ accentColor: T.gold, width: 18, height: 18 }}
        />
        <span style={{ fontFamily: T.font, fontWeight: 600, fontSize: 14, color: T.ink }}>{copy.name}</span>
      </div>
      <p style={{ margin: '6px 0 0 26px', fontSize: 12, color: T.muted, lineHeight: 1.4 }}>{copy.blurb}</p>
    </label>
  );
}

/** One swatch of the merchant's own photograph, treated or framed. */
function SwatchOption({
  name,
  blurb,
  image,
  imageStyle,
  wrapperStyle,
  selected,
  locked,
  disabled,
  group,
  onSelect,
}: {
  name: string;
  blurb: string;
  image: string | null;
  imageStyle?: React.CSSProperties;
  wrapperStyle?: React.CSSProperties;
  selected: boolean;
  locked?: boolean;
  disabled: boolean;
  group: string;
  onSelect: () => void;
}) {
  return (
    <label
      style={{
        display: 'block',
        border: `1px solid ${selected ? T.ink : T.line}`,
        borderRadius: 12,
        padding: 12,
        background: selected ? 'rgba(201,150,74,0.10)' : T.surface,
        cursor: disabled || locked ? 'default' : 'pointer',
        opacity: locked ? 0.55 : 1,
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <div style={{ aspectRatio: '1 / 1', ...(wrapperStyle ?? {}), position: 'relative', overflow: 'hidden' }}>
          {image ? (
            <img
              src={image}
              alt=""
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', ...(imageStyle ?? {}) }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', background: 'rgba(42,31,20,0.06)' }} />
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="radio"
          name={group}
          checked={selected}
          onChange={onSelect}
          disabled={disabled || locked}
          style={{ accentColor: T.gold, width: 18, height: 18 }}
        />
        <span style={{ fontFamily: T.font, fontWeight: 600, fontSize: 14, color: T.ink }}>{name}</span>
      </div>
      <p style={{ margin: '6px 0 0 26px', fontSize: 12, color: T.muted, lineHeight: 1.4 }}>
        {locked ? 'Part of Growth.' : blurb}
      </p>
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
