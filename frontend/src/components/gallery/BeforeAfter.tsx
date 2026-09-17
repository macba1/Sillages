import { GalleryPreviewCanvas } from './GalleryPreviewCanvas';
import { T } from './styleTokens';
import type { GalleryPreview } from '../../types/gallery';

/**
 * Their store today, beside their store with Sillages.
 *
 * The admin has always shown what the gallery looks like. It has never shown
 * what it replaces — so a merchant judged Sillages against an idea of their own
 * catalogue rather than against the thing itself, and the difference the app
 * actually makes was left to their imagination.
 *
 * Both sides are the merchant's own products and the merchant's own
 * photographs. The left is what a theme grid does with them: square crops, no
 * treatment, no frame. The right is the settings they have chosen. Nothing is
 * staged and nothing is borrowed from another shop.
 */
export function BeforeAfter({ preview }: { preview: GalleryPreview | null }) {
  if (!preview || preview.posts.length === 0) return null;

  // "Before" is the same payload with every choice turned off: this is the
  // theme grid, expressed in the same renderer so the comparison is fair.
  const before: GalleryPreview = {
    ...preview,
    layout: 'grid',
    style: 'original',
    filterIntensity: 0,
    frame: 'none',
    showStories: false,
  };

  return (
    <section
      aria-label="Your store today, and with Sillages"
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        marginBottom: 28,
      }}
    >
      <Side label="Your store today" note="Square crops, straight from the theme.">
        <GalleryPreviewCanvas preview={before} device="mobile" showDeviceToggle={false} maxPosts={6} />
      </Side>
      <Side label="With Sillages" note="The same products and the same photographs." highlight>
        <GalleryPreviewCanvas preview={preview} device="mobile" showDeviceToggle={false} maxPosts={6} />
      </Side>
    </section>
  );
}

function Side({
  label,
  note,
  highlight,
  children,
}: {
  label: string;
  note: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: `1px solid ${highlight ? 'rgba(201,150,74,0.55)' : T.line}`,
        borderRadius: 14,
        padding: 14,
        background: highlight ? 'rgba(201,150,74,0.06)' : T.surface,
      }}
    >
      <p
        style={{
          fontFamily: T.font,
          fontSize: 10,
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          color: highlight ? T.ink : T.muted,
          margin: '0 0 2px',
          fontWeight: 600,
        }}
      >
        {label}
      </p>
      <p style={{ fontSize: 13, color: T.muted, margin: '0 0 12px' }}>{note}</p>
      {children}
    </div>
  );
}
