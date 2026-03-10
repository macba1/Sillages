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
        <p style={{ fontSize: 13, color: '#A89880', marginBottom: 56 }}>Last updated: March 9, 2026</p>

        <p style={{ fontSize: 15, color: '#7A6B63', lineHeight: 1.8, marginBottom: 40 }}>
          Sillages ("we", "our", "the app") provides store analytics and daily briefs for Shopify merchants.
        </p>

        <Section title="What data we collect">
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>
              <strong style={{ color: '#3A2332' }}>Store data accessed through the Shopify API</strong> — orders, products, customers, and analytics, used solely to generate daily briefs and in-app insights.
            </li>
            <li>
              <strong style={{ color: '#3A2332' }}>Account information</strong> — email address and name, for authentication and delivering briefs.
            </li>
          </ul>
        </Section>

        <Section title="How we use your data">
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>Generate personalized daily briefs about store performance</li>
            <li>Provide actionable recommendations based on store data</li>
            <li>Deliver briefs via email</li>
            <li>Power the in-app chat feature</li>
          </ul>
        </Section>

        <Section title="Data storage and security">
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>All data stored on encrypted servers</li>
            <li>API tokens encrypted at rest</li>
            <li>We do not sell, share, or transfer data to third parties</li>
          </ul>
        </Section>

        <Section title="Data retention">
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>Store data retained while account is active</li>
            <li>Brief history retained for 90 days</li>
            <li>Upon account deletion, all data permanently removed within 30 days</li>
          </ul>
        </Section>

        <Section title="GDPR compliance">
          <p style={{ marginBottom: 12 }}>You have the right to:</p>
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>Request access to all data we hold about you</li>
            <li>Request deletion of your data at any time</li>
            <li>Request a portable copy of your data</li>
          </ul>
          <p style={{ marginTop: 12 }}>
            Contact:{' '}
            <a href="mailto:privacy@sillages.app" style={{ color: '#D8B07A', textDecoration: 'none' }}>privacy@sillages.app</a>
          </p>
        </Section>

        <Section title="Shopify data handling">
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>We comply with Shopify API Terms of Service</li>
            <li>We only request minimum necessary API scopes</li>
            <li>We respond to all mandatory Shopify webhooks</li>
          </ul>
        </Section>

        <Section title="Contact">
          <p>
            Questions? Email us at{' '}
            <a href="mailto:support@sillages.app" style={{ color: '#D8B07A', textDecoration: 'none' }}>support@sillages.app</a>.
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
