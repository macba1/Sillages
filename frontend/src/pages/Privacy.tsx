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
        <p style={{ fontSize: 13, color: '#A89880', marginBottom: 56 }}>Last updated: May 20, 2026</p>

        <p style={{ fontSize: 15, color: '#7A6B63', lineHeight: 1.8, marginBottom: 40 }}>
          Sillages ("we", "our", "the app") is a Shopify app that provides daily store intelligence briefs,
          automated cart recovery emails, and welcome emails for Shopify merchants.
          This policy explains what data we collect, why, and how we protect it.
        </p>

        <Section title="What data we collect">
          <p style={{ marginBottom: 12 }}>When you install Sillages, we access the following data through the Shopify API:</p>
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>
              <strong style={{ color: '#3A2332' }}>Orders and checkouts</strong> — order totals, product line items,
              abandoned checkout data. Used to generate daily briefs and trigger cart recovery emails.
            </li>
            <li>
              <strong style={{ color: '#3A2332' }}>Products</strong> — titles, descriptions, variants, and images.
              Used for product recommendations in emails and briefs.
            </li>
            <li>
              <strong style={{ color: '#3A2332' }}>Customers</strong> — name, email, order count. Used to identify
              new vs. returning customers and send welcome and cart recovery emails.
            </li>
            <li>
              <strong style={{ color: '#3A2332' }}>Store analytics</strong> — sessions, conversion rates, revenue.
              Used to power your daily intelligence brief.
            </li>
            <li>
              <strong style={{ color: '#3A2332' }}>Account information</strong> — your email address and name,
              for authentication and delivering briefs.
            </li>
          </ul>
        </Section>

        <Section title="How we use your data">
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>Generate personalized daily intelligence briefs about your store performance</li>
            <li>Send automated cart recovery emails to customers who abandoned their checkout</li>
            <li>Send welcome emails to new customers on your behalf</li>
            <li>Provide actionable recommendations based on store data</li>
            <li>Deliver briefs via email and push notifications</li>
          </ul>
          <p style={{ marginTop: 16 }}>
            We do <strong style={{ color: '#3A2332' }}>not</strong> sell, share, or transfer your data to third
            parties. Your data is used exclusively to provide Sillages services to you.
          </p>
        </Section>

        <Section title="Data storage and security">
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>All data is stored on Supabase with Row Level Security (RLS) enabled — each merchant can only access their own data</li>
            <li>All data is encrypted at rest and in transit (TLS 1.2+)</li>
            <li>Shopify API tokens are stored securely and never exposed to the frontend</li>
            <li>Our backend runs on Railway with automatic HTTPS</li>
            <li>We do not sell, share, or transfer data to third parties</li>
          </ul>
        </Section>

        <Section title="Emails sent on your behalf">
          <p style={{ marginBottom: 12 }}>
            Sillages sends cart recovery and welcome emails to your customers on your behalf. These emails:
          </p>
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>Are sent from your store name (e.g. "Your Store via Sillages")</li>
            <li>Include an unsubscribe link in every email</li>
            <li>Respect customer opt-out preferences</li>
            <li>Are powered by Resend (our email delivery provider)</li>
          </ul>
        </Section>

        <Section title="Billing">
          <p>
            Sillages uses the Shopify Billing API for all paid subscriptions. We do not collect or store
            credit card information. All billing is managed securely through your Shopify account.
          </p>
        </Section>

        <Section title="Data retention">
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>Store data is retained while your account is active</li>
            <li>Brief history is retained for 90 days</li>
            <li>Upon uninstalling the app, all data is permanently removed within 30 days</li>
          </ul>
        </Section>

        <Section title="GDPR and data compliance">
          <p style={{ marginBottom: 12 }}>We comply with GDPR and Shopify's mandatory data protection requirements. We handle all required Shopify webhooks:</p>
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li><strong style={{ color: '#3A2332' }}>customers/data_request</strong> — we provide all data we hold about a customer upon request</li>
            <li><strong style={{ color: '#3A2332' }}>customers/redact</strong> — we permanently delete all customer data when requested</li>
            <li><strong style={{ color: '#3A2332' }}>shop/redact</strong> — we permanently delete all shop data when the app is uninstalled</li>
          </ul>
          <p style={{ marginTop: 16, marginBottom: 12 }}>You have the right to:</p>
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>Request access to all data we hold about you or your customers</li>
            <li>Request deletion of your data at any time</li>
            <li>Request a portable copy of your data</li>
          </ul>
        </Section>

        <Section title="Shopify API compliance">
          <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>We comply with the Shopify API Terms of Service and App Store requirements</li>
            <li>We only request the minimum necessary API scopes</li>
            <li>We respond to all mandatory Shopify webhooks (GDPR and app lifecycle)</li>
            <li>We use the Shopify Billing API for all charges</li>
          </ul>
        </Section>

        <Section title="Contact">
          <p>
            Questions about your data or this policy? Contact us at{' '}
            <a href="mailto:tony@richmondpartner.com" style={{ color: '#D8B07A', textDecoration: 'none' }}>tony@richmondpartner.com</a>.
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
