import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { T, filterFor, frameStyle } from '../../components/gallery/styleTokens';
import type { GalleryFrame, GalleryStyle, PublicPost } from '../../types/gallery';
import { useNoIndex } from '../preview/useNoIndex';

/**
 * The backend, not this page's own origin.
 *
 * Written as a relative `/api/...` at first, which on the hosted frontend is
 * answered by the static site with its own index.html: the JSON parse failed
 * and every shared link told its visitor it had expired. Spelled out here
 * exactly as the axios client spells it — base plus a path that starts with
 * `/api` — because a second, nearly-right copy of the rule is how the first
 * mistake happened.
 */
const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

interface PicksPayload {
  mode: 'list' | 'vote';
  shop: string;
  style: GalleryStyle;
  frame: GalleryFrame;
  filterIntensity: number;
  showBranding: boolean;
  /** The shop's currency code. Null when the shop never recorded one. */
  currency: string | null;
  products: PublicPost[];
  votes: Record<number, number>;
  expiresAt: string;
}

/**
 * Somebody's picks, opened by a friend.
 *
 * This is the page the whole sharing feature exists to produce, so it is the
 * shop's own look — their treatment, their border, their photographs — and not
 * a Sillages screen with products in it. Nothing on it asks anyone to sign up:
 * the visitor sees what was chosen, optionally says which one they prefer, and
 * can go and buy any of it.
 *
 * No name, no email, no account, no comments. The vote is one tap, kept
 * against a random string this browser made up, and it says so.
 */
export default function SharedPicks() {
  const { token = '' } = useParams();
  const [data, setData] = useState<PicksPayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone'>('loading');
  const [myVote, setMyVote] = useState<number | null>(null);

  useNoIndex();

  /** Random, per-browser, and only ever used to stop double voting. */
  const voterKey = useMemo(() => {
    const KEY = 'sillages.voter';
    try {
      const existing = window.localStorage.getItem(KEY);
      if (existing) return existing;
      const made = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
      window.localStorage.setItem(KEY, made);
      return made;
    } catch {
      // Private mode, or storage refused. The vote still counts once for this
      // page view; it simply will not be remembered.
      return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/public/picks/${encodeURIComponent(token)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(String(response.status));
      setData((await response.json()) as PicksPayload);
      setState('ready');
    } catch {
      setState('gone');
    }
  }, [token]);

  useEffect(() => {
    void load();
    try {
      const remembered = window.localStorage.getItem(`sillages.vote.${token}`);
      if (remembered) setMyVote(Number(remembered));
    } catch {
      /* storage refused; the page still works */
    }
  }, [load, token]);

  async function vote(productId: number) {
    setMyVote(productId);
    try {
      window.localStorage.setItem(`sillages.vote.${token}`, String(productId));
    } catch {
      /* storage refused */
    }
    try {
      const response = await fetch(`${API}/api/public/picks/${encodeURIComponent(token)}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, voterKey }),
      });
      if (!response.ok) return;
      const body = (await response.json()) as { votes: Record<number, number> };
      setData((current) => (current ? { ...current, votes: body.votes } : current));
    } catch {
      // The tap already showed; a failed count is not worth an error message.
    }
  }

  if (state === 'loading') {
    return <Shell><p style={{ color: T.muted, fontSize: 14 }}>Opening…</p></Shell>;
  }

  if (state === 'gone' || !data) {
    return (
      <Shell>
        <h1 style={h1}>This link has expired</h1>
        <p style={{ color: T.body, fontSize: 15, lineHeight: 1.6, maxWidth: 460 }}>
          Shared picks are kept for a limited time, and whoever made this one may also have removed it.
        </p>
      </Shell>
    );
  }

  const filter = filterFor(data.style, data.filterIntensity);
  const frame = frameStyle(data.frame);
  const total = Object.values(data.votes).reduce((sum, n) => sum + n, 0);
  const shopName = data.shop.replace(/\.myshopify\.com$/i, '');

  return (
    <Shell>
      <p style={{ margin: 0, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.muted }}>
        {shopName}
      </p>
      <h1 style={h1}>{data.mode === 'vote' ? 'Which one?' : 'A few picks'}</h1>
      <p style={{ color: T.body, fontSize: 15, lineHeight: 1.6, margin: '0 0 24px', maxWidth: 520 }}>
        {data.mode === 'vote'
          ? 'Someone is deciding and wants your opinion. Tap the one you would pick — it is an informal poll, not a verified vote.'
          : 'Someone saved these and wanted you to see them.'}
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
          gap: 18,
          marginBottom: 32,
        }}
      >
        {data.products.map((post) => {
          const count = data.votes[post.id] ?? 0;
          const share = total > 0 ? Math.round((count / total) * 100) : 0;
          const mine = myVote === post.id;

          return (
            <article key={post.id}>
              <a
                href={`https://${data.shop}${post.url}`}
                target="_blank"
                rel="noopener"
                style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ ...frame, position: 'relative', overflow: 'hidden' }}>
                  <div
                    style={{
                      // Taller than square, and the whole photograph inside it.
                      // A square `cover` crop of a product shot shows only the
                      // middle: two snowboards arrived here as two black
                      // squares, which is no basis for choosing between them.
                      aspectRatio: '4 / 5',
                      borderRadius: Math.max(2, frame.borderRadius - 2),
                      overflow: 'hidden',
                      background: 'rgba(42,31,20,0.06)',
                    }}
                  >
                    {post.image?.url && (
                      <img
                        src={post.image.url}
                        alt={post.image.altText ?? post.title}
                        loading="lazy"
                        decoding="async"
                        style={{ width: '100%', height: '100%', objectFit: 'contain', filter, display: 'block' }}
                      />
                    )}
                  </div>
                </div>
                <div style={{ padding: '10px 2px 0' }}>
                  <div style={{ fontFamily: T.font, fontSize: 14, color: T.ink, lineHeight: 1.35 }}>{post.title}</div>
                  <div style={{ fontSize: 14, color: T.muted, marginTop: 2 }}>
                    {post.priceMin}
                    {post.priceMax && post.priceMax !== post.priceMin ? ` – ${post.priceMax}` : ''}
                    {data.currency ? ` ${data.currency}` : ''}
                  </div>
                </div>
              </a>

              {data.mode === 'vote' && (
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => void vote(post.id)}
                    aria-pressed={mine}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      minHeight: 44,
                      padding: '10px 14px',
                      borderRadius: 999,
                      border: `1px solid ${mine ? T.ink : T.line}`,
                      background: mine ? 'rgba(201,150,74,0.16)' : 'transparent',
                      color: T.ink,
                      fontFamily: T.font,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Heart size={16} fill={mine ? T.gold : 'none'} color={mine ? T.gold : T.muted} />
                    {mine ? 'Your pick' : 'This one'}
                    {total > 0 && <span style={{ marginLeft: 'auto', fontWeight: 400, color: T.muted }}>{share}%</span>}
                  </button>
                  <div style={{ height: 4, borderRadius: 999, background: T.line, marginTop: 8, overflow: 'hidden' }}>
                    <div style={{ width: `${share}%`, height: '100%', background: T.gold, transition: 'width 0.3s ease' }} />
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, maxWidth: 520 }}>
        {data.mode === 'vote'
          ? 'An informal poll between friends. Nobody needs an account, nothing here records who you are, and one browser counts once.'
          : 'Nobody needs an account to open this, and nothing here records who you are.'}
        {data.showBranding && ' Made with Sillages.'}
      </p>
    </Shell>
  );
}

const h1: React.CSSProperties = {
  fontFamily: T.font,
  fontSize: 30,
  fontWeight: 600,
  color: T.ink,
  margin: '6px 0 10px',
  letterSpacing: '-0.02em',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#F7F1EC', padding: '48px 20px 64px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>{children}</div>
    </div>
  );
}
