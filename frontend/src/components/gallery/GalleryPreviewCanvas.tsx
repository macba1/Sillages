import { useState } from 'react';
import { Smartphone, Monitor } from 'lucide-react';
import type { GalleryPreview } from '../../types/gallery';
import { STYLE_TOKENS, T } from './styleTokens';

/**
 * Renders the gallery the way the storefront will, so what a merchant approves
 * here is what a shopper gets. It reuses the same style tokens as the theme
 * extension's CSS.
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
  const tokens = STYLE_TOKENS[preview.style];
  const columns = device === 'mobile' ? 2 : 4;

  if (posts.length === 0) {
    return (
      <p style={{ color: T.body, fontSize: 14 }}>
        Nothing to show yet. Sync your catalogue, or pick a collection that has products.
      </p>
    );
  }

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
          maxWidth: device === 'mobile' ? 390 : '100%',
          margin: device === 'mobile' ? '0 auto' : undefined,
          border: `1px solid ${T.line}`,
          borderRadius: device === 'mobile' ? 24 : 12,
          padding: device === 'mobile' ? 12 : 16,
          background: '#fff',
        }}
      >
        {preview.heading && (
          <h3 style={{ fontFamily: T.font, fontSize: 16, fontWeight: 600, color: T.ink, margin: '4px 0 12px' }}>
            {preview.heading}
          </h3>
        )}

        {preview.showStories && preview.stories.length > 0 && (
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
            {preview.stories.map((story) => (
              <div key={story.id} style={{ flex: '0 0 auto', width: 64, textAlign: 'center' }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    margin: '0 auto',
                    overflow: 'hidden',
                    background: 'rgba(42,31,20,0.06)',
                    outline: `2px solid rgba(42,31,20,0.06)`,
                    outlineOffset: 2,
                  }}
                >
                  {story.imageUrl && (
                    <img
                      src={story.imageUrl}
                      alt=""
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', filter: tokens.filter }}
                    />
                  )}
                </div>
                <span
                  style={{
                    display: 'block',
                    marginTop: 6,
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
            ))}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: device === 'mobile' ? 8 : 16 }}>
          {posts.map((post) => (
            <article key={post.id} style={{ background: tokens.cardBg, borderRadius: tokens.radius, padding: tokens.pad }}>
              <div
                style={{
                  aspectRatio: '1 / 1',
                  borderRadius: Math.max(2, tokens.radius - 2),
                  overflow: 'hidden',
                  background: 'rgba(42,31,20,0.06)',
                }}
              >
                <img
                  src={post.image!.url}
                  alt={post.image!.altText ?? post.title}
                  loading="lazy"
                  decoding="async"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', filter: tokens.filter, display: 'block' }}
                />
              </div>
              <div style={{ padding: '8px 2px 0' }}>
                <div
                  style={{
                    fontSize: 12,
                    lineHeight: 1.3,
                    color: T.ink,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {post.title}
                </div>
                <div style={{ fontSize: 12, color: T.muted }}>{priceLabel(post.priceMin, post.priceMax)}</div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function priceLabel(min: string | null, max: string | null): string {
  if (!min) return '';
  if (!max || min === max) return min;
  return `${min} – ${max}`;
}
