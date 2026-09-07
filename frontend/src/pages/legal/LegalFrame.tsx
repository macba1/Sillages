import { Link } from 'react-router-dom';
import { T } from '../../components/gallery/styleTokens';

/** Shared chrome for the new product's legal pages. */
export function LegalFrame({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', background: '#F7F1EC' }}>
      <header style={{ borderBottom: '1px solid #E8DDD6' }}>
        <div
          style={{
            maxWidth: 800,
            margin: '0 auto',
            padding: '0 24px',
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Link to="/" style={{ fontSize: 15, fontWeight: 600, color: T.ink, textDecoration: 'none' }}>
            sillages
          </Link>
          <Link to="/login" style={{ fontSize: 13, color: T.body, textDecoration: 'none' }}>
            Sign in →
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '48px 24px 80px' }}>
        <h1 style={{ fontFamily: T.font, fontSize: 30, fontWeight: 700, color: T.ink, margin: '0 0 8px' }}>{title}</h1>
        <p style={{ fontSize: 13, color: T.muted, marginTop: 0, marginBottom: 40 }}>Last updated {updated}</p>
        {children}
      </main>

      <footer style={{ borderTop: '1px solid #E8DDD6', padding: '24px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', gap: 20, fontSize: 13 }}>
          <Link to="/privacy" style={{ color: T.body, textDecoration: 'none' }}>Privacy</Link>
          <Link to="/terms" style={{ color: T.body, textDecoration: 'none' }}>Terms</Link>
        </div>
      </footer>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontFamily: T.font, fontSize: 18, fontWeight: 600, color: T.ink, marginBottom: 12 }}>{title}</h2>
      <div style={{ fontSize: 15, color: T.body, lineHeight: 1.8 }}>{children}</div>
    </section>
  );
}
