import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { T } from '../../components/gallery/styleTokens';
import { useNoIndex } from './useNoIndex';

/**
 * Public entry point: paste a Shopify store address and get a private demo of
 * that store as a shoppable gallery. Nothing is installed and nothing about the
 * store is changed — it only reads what the storefront already publishes.
 */
export default function DemoForm() {
  useNoIndex();
  const navigate = useNavigate();

  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ token: string }>('/api/public/preview', { url: url.trim() });
      navigate(`/demo/${res.data.token}`);
    } catch (err) {
      const response = (err as { response?: { status?: number; data?: { message?: string } } }).response;
      setError(
        response?.data?.message ??
          (response?.status === 429
            ? 'That is a lot of previews. Try again in a few minutes.'
            : 'We could not build a preview for that address.'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: '100dvh', background: '#F7F1EC', padding: '64px 20px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <p style={{ fontFamily: T.font, fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', color: T.muted, marginBottom: 12 }}>
          Sillages
        </p>
        <h1 style={{ fontFamily: T.font, fontSize: 32, fontWeight: 700, color: T.ink, margin: '0 0 12px', lineHeight: 1.2 }}>
          See your store as a shoppable gallery
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: T.body, marginTop: 0, marginBottom: 28 }}>
          Paste your Shopify store address. We will build a private before-and-after from your own products and
          photographs. Nothing is installed and nothing in your store changes.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label htmlFor="store-url" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            Your store address
          </label>
          <input
            id="store-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="your-store.myshopify.com"
            autoComplete="url"
            inputMode="url"
            style={{
              flex: '1 1 260px',
              minHeight: 48,
              padding: '12px 14px',
              borderRadius: 10,
              border: `1px solid ${T.line}`,
              fontSize: 15,
              fontFamily: T.font,
              color: T.ink,
              background: '#fff',
            }}
          />
          <button
            type="submit"
            disabled={busy || !url.trim()}
            style={{
              minHeight: 48,
              padding: '12px 22px',
              borderRadius: 10,
              border: 0,
              background: T.gold,
              color: T.ink,
              fontFamily: T.font,
              fontWeight: 600,
              fontSize: 15,
              cursor: busy || !url.trim() ? 'default' : 'pointer',
              opacity: busy || !url.trim() ? 0.5 : 1,
            }}
          >
            {busy ? 'Building…' : 'Show me'}
          </button>
        </form>

        {error && (
          <p role="alert" style={{ color: T.danger, fontSize: 14, marginTop: 14 }}>
            {error}
          </p>
        )}

        <p style={{ fontSize: 13, color: T.muted, marginTop: 24, lineHeight: 1.6 }}>
          The demo is private, expires on its own, and is never indexed by search engines.
        </p>
      </div>
    </main>
  );
}
