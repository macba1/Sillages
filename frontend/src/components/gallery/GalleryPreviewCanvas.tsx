import { useState } from 'react';
import { Smartphone, Monitor, Heart } from 'lucide-react';
import type { GalleryPreview } from '../../types/gallery';
import { T, filterFor, frameStyle } from './styleTokens';

/**
 * Renders the gallery the way the storefront will, so what a merchant approves
 * here is what a shopper gets.
 *
 * It deliberately reimplements the extension's CSS rather than importing it:
 * the storefront stylesheet is scoped to a block that only exists on a live
 * theme. The numbers are the ones in `social-gallery.css`, and the tests pin
 * them together so the two cannot drift apart unnoticed.
 */
export function GalleryPreviewCanvas({
  preview,
  device: initialDevice = 'mobile',
  showDeviceToggle = true,
  maxPosts,
}: {
  preview: GalleryPreview | null;
  device?: 'mobile' | 'desktop';
  showDeviceToggle?: boolean;
  maxPosts?: number;
}) {
  const [device, setDevice] = useState<'mobile' | 'desktop'>(initialDevice);

  if (!preview) return null;

  const posts = (maxPosts ? preview.posts.slice(0, maxPosts) : preview.posts).filter((p) => p.image?.url);
  const filter = filterFor(preview.style, preview.filterIntensity);
  const frame = frameStyle(preview.frame);
  const layout = preview.layout ?? 'grid';
  const mobile = device === 'mobile';

  // The same column counts as the storefront's media queries.
  const columns = layout === 'feed' ? 1 : layout === 'stories' ? (mobile ? 3 : 4) : mobile ? 2 : 4;

  if (posts.length === 0) {
    return (
      <p style={{ color: T.body, fontSize: 14 }}>
        Nothing to show yet. Sync your catalogue, or pick a collection that has products.
      </p>
    );
  }

  /** Polaroid tilts by position, never at random, exactly as the storefront does. */
  const tilt = (index: number) =>
    layout === 'polaroid' ? [-1.1, 0.8, -0.4, 1.3, -0.9, 0.5, -1.4][index % 7] : 0;

  const ratio = (index: number) => {
    if (layout === 'feed') return '4 / 5';
    if (layout !== 'polaroid') return '1 / 1';
    if (index % 3 === 1) return '4 / 5';
    if (index % 5 === 2) return '5 / 4';
    return '1 / 1';
  };

  return (
    <div>
      {showDeviceToggle && (
        <div role="group" aria-label="Preview device" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {([
            { key: 'mobile' as const, icon: Smartphone, label: 'Mobile' },
            { key: 'desktop' as const, icon: Monitor, label: 'Desktop' },
          ]).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setDevice(key)}
              aria-pressed={device === key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                minHeight: 40,
                borderRadius: 999,
                border: `1px solid ${device === key ? T.ink : T.line}`,
                background: device === key ? 'rgba(201,150,74,0.16)' : 'transparent',
                color: T.ink,
                fontFamily: T.font,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          maxWidth: mobile ? 390 : '100%',
          margin: mobile ? '0 auto' : undefined,
          border: `1px solid ${T.line}`,
          borderRadius: mobile ? 24 : 12,
          padding: mobile ? 12 : 16,
          background: '#fff',
        }}
      >
        {preview.heading && (
          <h3 style={{ fontFamily: T.font, fontSize: 16, fontWeight: 600, color: T.ink, margin: '4px 0 12px' }}>
            {preview.heading}
          </h3>
        )}

        {preview.showStories && preview.stories.length > 0 && (
          <div style={{ display: 'flex', gap: layout === 'stories' ? 16 : 12, overflowX: 'auto', paddingBottom: 14 }}>
            {preview.stories.map((story) => {
              const size = layout === 'stories' ? 76 : 56;
              return (
                <div key={story.id} style={{ flex: '0 0 auto', width: size + 10, textAlign: 'center' }}>
                  <div
                    style={{
                      width: size,
                      height: size,
                      borderRadius: '50%',
                      margin: '0 auto',
                      overflow: 'hidden',
                      background: 'rgba(42,31,20,0.06)',
                      boxShadow: `0 0 0 2px #fff, 0 0 0 4px rgba(42,31,20,0.30)`,
                    }}
                  >
                    {story.imageUrl && (
                      <img
                        src={story.imageUrl}
                        alt=""
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', filter }}
                      />
                    )}
                  </div>
                  <span
                    style={{
                      display: 'block',
                      marginTop: 7,
                      fontSize: 10,
                      color: T.body,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {story.title}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div
          style={
            layout === 'polaroid'
              ? { columns: columns, columnGap: mobile ? 10 : 16 }
              : {
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, 1fr)`,
                  gap: layout === 'feed' ? 24 : mobile ? 8 : 16,
                  maxWidth: layout === 'feed' ? 380 : undefined,
                  margin: layout === 'feed' ? '0 auto' : undefined,
                }
          }
        >
          {posts.map((post, index) => (
            <article
              key={post.id}
              style={{
                breakInside: 'avoid',
                marginBottom: layout === 'polaroid' ? (mobile ? 14 : 20) : undefined,
                display: layout === 'polaroid' ? 'inline-block' : undefined,
                width: layout === 'polaroid' ? '100%' : undefined,
              }}
            >
              <div
                style={{
                  position: 'relative',
                  padding: frame.padding,
                  background: frame.background,
                  boxShadow: frame.boxShadow,
                  borderRadius: frame.borderRadius,
                  transform: tilt(index) ? `rotate(${tilt(index)}deg)` : undefined,
                }}
              >
                <div
                  style={{
                    aspectRatio: ratio(index),
                    borderRadius: Math.max(2, frame.borderRadius - 2),
                    overflow: 'hidden',
                    background: 'rgba(42,31,20,0.06)',
                  }}
                >
                  <img
                    src={post.image!.url}
                    alt={post.image!.altText ?? post.title}
                    loading="lazy"
                    decoding="async"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', filter, display: 'block' }}
                  />
                </div>

                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.86)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'rgba(0,0,0,0.42)',
                  }}
                >
                  <Heart size={15} />
                </span>

                {preview.frame === 'polaroid' && (
                  <span
                    style={{
                      position: 'absolute',
                      left: 10,
                      right: 10,
                      bottom: 8,
                      fontSize: 10,
                      color: '#4A463F',
                      textAlign: 'center',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {post.title}
                  </span>
                )}
              </div>

              {preview.frame !== 'polaroid' && (
                <div style={{ padding: '8px 2px 0' }}>
                  <div
                    style={{
                      fontSize: layout === 'feed' ? 14 : 12,
                      lineHeight: 1.35,
                      color: T.ink,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {post.title}
                  </div>
                  <div style={{ fontSize: layout === 'feed' ? 14 : 12, color: T.muted, marginTop: 2 }}>
                    {post.priceMin}
                    {post.priceMax && post.priceMax !== post.priceMin ? ` – ${post.priceMax}` : ''}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
