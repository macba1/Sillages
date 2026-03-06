import { Link } from 'react-router-dom';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: '#3A2332', marginBottom: 12, letterSpacing: '-0.01em' }}>
        {title}
      </h2>
      <div style={{ fontSize: 15, color: '#7A6B63', lineHeight: 1.8 }}>
        {children}
      </div>
    </div>
  );
}

export default function Privacy() {
  return (
    <div style={{ minHeight: '100vh', background: '#F7F1EC' }}>
      {/* Nav */}
      <header style={{ borderBottom: '1px solid #E8DDD6', background: '#F7F1EC' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/" style={{ fontSize: 15, fontWeight: 600, color: '#3A2332', textDecoration: 'none', letterSpacing: '-0.01em' }}>
            sillages
          </Link>
          <Link to="/login" style={{ fontSize: 13, color: '#7A6B63', textDecoration: 'none' }}>
            Sign in →
          </Link>
        </div>
      </header>

      {/* Content */}
      <main style={{ maxWidth: 680, margin: '0 auto', padding: '64px 24px 96px' }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#D8B07A', marginBottom: 16 }}>
          Legal
        </p>
        <h1 style={{ fontSize: 36, fontWeight: 600, color: '#3A2332', marginBottom: 8, letterSpacing: '-0.02em', lineHeight: 1.2, fontFamily: "'DM Serif Display', serif" }}>
          Privacy Policy
        </h1>
        <p style={{ fontSize: 13, color: '#A89880', marginBottom: 56 }}>Last updated: March 2026</p>

        <Section title="The short version">
          <p>
            We collect only what we need to run Sillages. We never sell your data. We never share it with
            third parties for advertising. You can delete your account and all your data at any time by
            emailing us.
          </p>
        </Section>

        <Section title="What we collect">
          <p style={{ marginBottom: 12 }}>We collect the following data when you use Sillages:</p>
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li><strong style={{ color: '#3A2332' }}>Your email address</strong> — used to create your account and send you your daily brief.</li>
            <li><strong style={{ color: '#3A2332' }}>Your name</strong> — used to personalise your brief. Optional.</li>
            <li><strong style={{ color: '#3A2332' }}>Shopify store data</strong> — orders, revenue, sessions, product performance, and refunds. We pull this every night to generate your brief. We request read-only access — we never modify your Shopify store.</li>
            <li><strong style={{ color: '#3A2332' }}>Usage data</strong> — which pages you visit in the app, so we can improve the product. No third-party trackers.</li>
            <li><strong style={{ color: '#3A2332' }}>Language preference</strong> — to deliver your brief in your preferred language.</li>
          </ul>
        </Section>

        <Section title="How we use it">
          <p style={{ marginBottom: 12 }}>We use your data for one purpose: to give you a useful daily intelligence brief about your store.</p>
          <p style={{ marginBottom: 12 }}>
            Your Shopify data is sent to OpenAI's API to generate the written analysis. OpenAI does not use your data to train their models (we use their API under their data processing terms).
          </p>
          <p>
            We do not sell your data. We do not share it with advertisers. We do not use it for any purpose
            other than running Sillages.
          </p>
        </Section>

        <Section title="How it's stored">
          <p style={{ marginBottom: 12 }}>
            Your data is stored in Supabase, a managed database service hosted on AWS in the US. Data is
            encrypted at rest and in transit.
          </p>
          <p>
            Your Shopify access token is stored encrypted and is only used for nightly data pulls. We store
            daily snapshots of your store metrics — not your full Shopify data.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            We keep your data for as long as your account is active. Daily snapshots are kept for up to
            12 months. If you delete your account, we delete all your data within 30 days.
          </p>
        </Section>

        <Section title="Your rights">
          <p style={{ marginBottom: 12 }}>You have the right to:</p>
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>Access the data we hold about you</li>
            <li>Correct any inaccurate data</li>
            <li>Delete your account and all associated data</li>
            <li>Export your data</li>
          </ul>
          <p style={{ marginTop: 12 }}>
            To exercise any of these rights, email us at{' '}
            <a href="mailto:tony@sillages.app" style={{ color: '#D8B07A', textDecoration: 'none' }}>tony@sillages.app</a>.
            We'll respond within 5 business days.
          </p>
        </Section>

        <Section title="Cookies">
          <p>
            We use a single session cookie to keep you logged in. We do not use any advertising or
            tracking cookies.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If we make significant changes to this policy, we'll notify you by email before they take
            effect. The "last updated" date at the top of this page will always reflect the most recent
            version.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions? Email us at{' '}
            <a href="mailto:tony@sillages.app" style={{ color: '#D8B07A', textDecoration: 'none' }}>tony@sillages.app</a>.
          </p>
        </Section>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid #E8DDD6' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <p style={{ fontSize: 12, color: '#A89880' }}>© 2026 Sillages. All rights reserved.</p>
          <div style={{ display: 'flex', gap: 24 }}>
            <Link to="/privacy" style={{ fontSize: 12, color: '#A89880', textDecoration: 'none' }}>Privacy Policy</Link>
            <Link to="/terms" style={{ fontSize: 12, color: '#A89880', textDecoration: 'none' }}>Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
