import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../lib/api';
import { STYLE_TOKENS, T } from '../../components/gallery/styleTokens';
import type { GalleryStyle } from '../../types/gallery';
import { useNoIndex } from './useNoIndex';

interface ProposalPost {
  id: number;
  title: string;
  handle: string;
  url: string;
  imageUrl: string;
  alt: string | null;
  priceMin: string | null;
  priceMax: string | null;
}

interface Proposal {
  style: GalleryStyle;
  name: string;
  description: string;
  posts: ProposalPost[];
}

interface PreviewPayload {
  shopDomain: string;
  sourceUrl: string;
  status: 'pending' | 'ready' | 'failed' | 'claimed' | 'expired';
  expired: boolean;
  expiresAt: string;
  productCount: number;
  proposals: Proposal[];
  claimed: boolean;
}

/**
 * The private before/after a shop owner is sent.
 *
 * "Before" is their catalogue as a plain product list — what most storefronts
 * look like today. "After" is the same products, same photographs, arranged as
 * a shoppable gallery. Nothing is invented: every image and price comes from
 * their own store.
 */
export default function DemoPreview() {
  useNoIndex();
  const { token = '' } = useParams();

  const [data, setData] = useState<PreviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GalleryStyle>('original');
  const [view, setView] = useState<'after' | 'before'>('after');
  const [installing, setInstalling] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<PreviewPayload>(`/api/public/preview/${encodeURIComponent(token)}`);
      setData(res.data);
      if (res.data.proposals[0]) setSelected(res.data.proposals[0].style);
      setError(null);
    } catch {
      setError('This preview no longer exists. Ask us for a fresh one.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleInstall() {
    setInstalling(true);
    setError(null);
    try {
      const res = await api.post<{ installUrl: string }>(
        `/api/public/preview/${encodeURIComponent(token)}/claim`,
        { proposal: selected },
      );
      window.location.href = res.data.installUrl;
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      setError(message ?? 'We could not start the installation. Try again in a moment.');
      setInstalling(false);
    }
  }

  if (loading) {
    return <Frame><p style={{ color: T.body }}>Loading your preview…</p></Frame>;
  }

  if (error && !data) {
    return <Frame><p role="alert" style={{ color: T.danger }}>{error}</p></Frame>;
  }

  if (!data || data.expired || data.proposals.length === 0) {
    return (
      <Frame>
        <h1 style={heading}>This preview has expired</h1>
        <p style={{ color: T.body, fontSize: 15, lineHeight: 1.6 }}>
          Previews are temporary on purpose. Ask us and we will build you a fresh one.
        </p>
      </Frame>
    );
  }

  const proposal = data.proposals.find((p) => p.style === selected) ?? data.proposals[0];
  const tokens = STYLE_TOKENS[proposal.style];

  return (
    <Frame>
      <p style={eyebrow}>{data.shopDomain}</p>
      <h1 style={heading}>Your store as a shoppable gallery</h1>
      <p style={{ fontSize: 16, lineHeight: 1.6, color: T.body, marginTop: 0, marginBottom: 24 }}>
        These are your own {data.productCount} products and your own photographs — nothing has been added,
        retouched or invented. Your store has not been changed in any way.
      </p>

      {/* Before / after */}
      <div role="group" aria-label="Compare" style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {([
          { key: 'before' as const, label: 'Your store today' },
          { key: 'after' as const, label: 'With Sillages' },
        ]).map((option) => (
          <button
            key={option.key}
            onClick={() => setView(option.key)}
            aria-pressed={view === option.key}
            style={{
              padding: '10px 16px',
              minHeight: 44,
              borderRadius: 999,
              border: `1px solid ${view === option.key ? T.ink : T.line}`,
              background: view === option.key ? 'rgba(201,150,74,0.16)' : '#fff',
              color: T.ink,
              fontFamily: T.font,
              fontWeight: view === option.key ? 600 : 500,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {view === 'after' && (
        <div role="group" aria-label="Design" style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {data.proposals.map((option) => (
            <button
              key={option.style}
              onClick={() => setSelected(option.style)}
              aria-pressed={selected === option.style}
              style={{
                padding: '8px 14px',
                minHeight: 40,
                borderRadius: 999,
                border: `1px solid ${selected === option.style ? T.ink : T.line}`,
                background: selected === option.style ? 'rgba(201,150,74,0.16)' : '#fff',
                color: T.ink,
                fontFamily: T.font,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {option.name}
            </button>
          ))}
        </div>
      )}

      {view === 'after' && (
        <p style={{ fontSize: 14, color: T.muted, margin: '0 0 16px' }}>{proposal.description}</p>
      )}

      <div style={{ border: `1px solid ${T.line}`, borderRadius: 16, padding: 16, background: '#fff', marginBottom: 28 }}>
        {view === 'before' ? <BeforeGrid posts={proposal.posts} /> : <AfterGrid posts={proposal.posts} tokens={tokens} />}
      </div>

      {/* Install */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          padding: '16px 0',
          background: 'linear-gradient(to top, #F7F1EC 70%, transparent)',
        }}
      >
        <button
          onClick={() => void handleInstall()}
          disabled={installing}
          style={{
            width: '100%',
            minHeight: 52,
            borderRadius: 12,
            border: 0,
            background: T.gold,
            color: T.ink,
            fontFamily: T.font,
            fontWeight: 700,
            fontSize: 16,
            cursor: installing ? 'default' : 'pointer',
            opacity: installing ? 0.6 : 1,
          }}
        >
          {installing ? 'Opening Shopify…' : `Publish the ${proposal.name} design in my store`}
        </button>
        <p style={{ fontSize: 12, color: T.muted, textAlign: 'center', marginTop: 10, marginBottom: 0 }}>
          Installs Sillages from Shopify and brings this exact design with you. You still preview and publish it
          yourself.
        </p>
        {error && (
          <p role="alert" style={{ color: T.danger, fontSize: 13, textAlign: 'center', marginTop: 8 }}>
            {error}
          </p>
        )}
      </div>
    </Frame>
  );
}

/** The plain product list most storefronts show today. */
function BeforeGrid({ posts }: { posts: ProposalPost[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 20 }}>
      {posts.slice(0, 12).map((post) => (
        <div key={post.id} style={{ textAlign: 'center' }}>
          <div style={{ aspectRatio: '1 / 1', background: '#F2EEE9', marginBottom: 8 }}>
            <img
              src={post.imageUrl}
              alt={post.alt ?? post.title}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          </div>
          <div style={{ fontSize: 12, color: T.ink, lineHeight: 1.3 }}>{post.title}</div>
          <div style={{ fontSize: 12, color: T.muted }}>{post.priceMin}</div>
        </div>
      ))}
    </div>
  );
}

/** The same products as a gallery. */
function AfterGrid({ posts, tokens }: { posts: ProposalPost[]; tokens: (typeof STYLE_TOKENS)[GalleryStyle] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
      {posts.slice(0, 12).map((post) => (
        <article key={post.id} style={{ background: tokens.cardBg, borderRadius: tokens.radius, padding: tokens.pad }}>
          <div style={{ aspectRatio: '1 / 1', borderRadius: Math.max(2, tokens.radius - 2), overflow: 'hidden', background: '#F2EEE9' }}>
            <img
              src={post.imageUrl}
              alt={post.alt ?? post.title}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', filter: tokens.filter, display: 'block' }}
            />
          </div>
          <div style={{ padding: '8px 2px 0' }}>
            <div style={{ fontSize: 12, color: T.ink, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {post.title}
            </div>
            <div style={{ fontSize: 12, color: T.muted }}>{post.priceMin}</div>
          </div>
        </article>
      ))}
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: '100dvh', background: '#F7F1EC', padding: '40px 20px 0' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>{children}</div>
    </main>
  );
}

const eyebrow: React.CSSProperties = {
  fontFamily: T.font,
  fontSize: 10,
  letterSpacing: '0.28em',
  textTransform: 'uppercase',
  color: T.muted,
  marginBottom: 10,
};

const heading: React.CSSProperties = {
  fontFamily: T.font,
  fontSize: 30,
  fontWeight: 700,
  color: T.ink,
  margin: '0 0 12px',
  lineHeight: 1.2,
};
