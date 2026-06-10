import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import type { Lang } from '../contexts/LanguageContext';

// ── Shopify App Store URL ───────────────────────────────────────────────────
const SHOPIFY_APP_URL = 'https://apps.shopify.com/sillages';

// ── Mock brief card ─────────────────────────────────────────────────────────

function BriefCard() {
  const { t } = useLanguage();

  return (
    <div style={{
      width: 360,
      background: '#2A1F14',
      borderRadius: 24,
      padding: '32px',
      border: '1px solid rgba(201,150,74,0.2)',
      boxShadow: '0 32px 80px rgba(0,0,0,0.4)',
      animation: 'cardFadeUp 0.6s ease forwards',
      opacity: 0,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'rgba(201,150,74,0.15)',
            border: '1px solid rgba(201,150,74,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span style={{ color: '#C9964A', fontSize: 13, fontFamily: "'DM Serif Display', serif", fontWeight: 400 }}>S</span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C9964A' }}>
            Sillages
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="agent-pulse" style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#2D6A4F',
          }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#2D6A4F' }}>
            {t('landing.card.active')}
          </span>
        </div>
      </div>

      <div style={{ height: 1, background: 'rgba(201,150,74,0.15)', marginBottom: 20 }} />

      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(245,239,232,0.35)', marginBottom: 12 }}>
        {t('landing.card.date')}
      </p>

      <p style={{ fontSize: 22, color: '#F5EFE8', lineHeight: 1.3, marginBottom: 16, fontFamily: "'DM Serif Display', serif", fontWeight: 400 }}>
        {t('landing.card.greeting')}
      </p>

      <p style={{ fontSize: 14, color: 'rgba(245,239,232,0.6)', lineHeight: 1.75, fontWeight: 300, marginBottom: 24 }}>
        {t('landing.card.body')}
      </p>

      <div style={{ height: 1, background: 'rgba(201,150,74,0.15)', marginBottom: 20 }} />

      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#C9964A', marginBottom: 10 }}>
        {t('landing.card.sectionLabel')}
      </p>

      <p style={{ fontSize: 13, color: 'rgba(245,239,232,0.7)', lineHeight: 1.7, marginBottom: 24 }}>
        {t('landing.card.action')}
      </p>

      <p style={{ fontSize: 11, color: 'rgba(245,239,232,0.25)', lineHeight: 1.6 }}>
        {t('landing.card.footer')}
      </p>
    </div>
  );
}

// ── Pricing card ────────────────────────────────────────────────────────────

function PricingCard({ name, price, period, features, highlighted, cta }: {
  name: string; price: number; period: string; features: string[];
  highlighted?: boolean; cta: string;
}) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 16,
      border: highlighted ? '2px solid #C9964A' : '1px solid #E8DDD6',
      padding: '32px 24px',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      flex: '1 1 220px',
      minWidth: 200,
      boxShadow: highlighted ? '0 8px 32px rgba(201,150,74,0.15)' : '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      {highlighted && (
        <div style={{
          position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
          background: '#C9964A', color: '#fff', fontSize: 10, fontWeight: 700,
          padding: '4px 14px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          Most Popular
        </div>
      )}
      <h3 style={{ fontSize: 18, fontWeight: 700, color: '#3A2332', margin: '0 0 8px' }}>{name}</h3>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 36, fontWeight: 700, color: '#3A2332' }}>
          {price === 0 ? '$0' : `$${price}`}
        </span>
        <span style={{ fontSize: 14, color: '#7A6B63', marginLeft: 4 }}>{period}</span>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', flex: 1 }}>
        {features.map(f => (
          <li key={f} style={{ fontSize: 13, color: '#5A4E47', padding: '4px 0', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ color: '#C9964A', fontSize: 14, lineHeight: 1.3 }}>✓</span>
            {f}
          </li>
        ))}
      </ul>
      <a
        href={SHOPIFY_APP_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block',
          textAlign: 'center',
          width: '100%',
          padding: '12px 16px',
          borderRadius: 8,
          border: 'none',
          fontSize: 14,
          fontWeight: 600,
          textDecoration: 'none',
          background: highlighted ? '#C9964A' : '#3A2332',
          color: '#fff',
          transition: 'opacity 0.15s',
          boxSizing: 'border-box',
        }}
      >
        {cta}
      </a>
    </div>
  );
}

// ── Feature card ────────────────────────────────────────────────────────────

function FeatureCard({ icon, title, description }: { icon: string; title: string; description?: string }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 16,
      padding: '32px 28px',
      border: '1px solid #E8DDD6',
      flex: '1 1 240px',
      minWidth: 220,
    }}>
      <span style={{ fontSize: 32, display: 'block', marginBottom: 16 }}>{icon}</span>
      <h3 style={{ fontSize: 17, fontWeight: 600, color: '#3A2332', marginBottom: description ? 8 : 0, letterSpacing: '-0.01em', lineHeight: 1.35 }}>
        {title}
      </h3>
      {description && (
        <p style={{ fontSize: 14, color: '#7A6B63', lineHeight: 1.7, margin: 0 }}>
          {description}
        </p>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Landing() {
  const { lang, setLang, t } = useLanguage();

  return (
    <div className="min-h-screen bg-[#F7F1EC]">

      {/* Language toggle */}
      <div style={{ position: 'fixed', top: 24, right: 24, zIndex: 100, display: 'flex', gap: 4 }}>
        {(['en', 'es'] as Lang[]).map(l => (
          <button
            key={l}
            onClick={() => setLang(l)}
            style={{
              padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.08em', cursor: 'pointer', border: 'none',
              background: lang === l ? '#C9964A' : 'rgba(58,35,50,0.08)',
              color: lang === l ? '#2A1F14' : '#A89880',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Nav */}
      <header className="border-b border-[#E8DDD6] bg-[#F7F1EC]">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-[#3A2332] font-semibold tracking-tight text-base">sillages</span>
          <div className="flex items-center gap-6">
            <Link to="/login" className="text-sm text-[#7A6B63] hover:text-[#3A2332] transition-colors">
              {t('landing.nav.signIn')}
            </Link>
            <a
              href={SHOPIFY_APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#D8B07A] text-[#1A1A2E] text-sm font-medium px-4 py-2 hover:bg-[#c9a06a] transition-colors"
              style={{ textDecoration: 'none' }}
            >
              {t('landing.nav.install')}
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-20">
        <div style={{ display: 'flex', alignItems: 'center', gap: 64, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 340px', minWidth: 280 }}>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#D8B07A] mb-6">
              {t('landing.badge')}
            </p>
            <h1 className="text-[#3A2332] text-5xl font-semibold tracking-tight leading-[1.1] mb-6">
              {t('landing.hero.title1')}
              <br />
              {t('landing.hero.title2')}
            </h1>
            <p className="text-[#7A6B63] text-lg leading-relaxed mb-10">
              {t('landing.hero.body')}
            </p>
            <div className="flex items-center gap-4 flex-wrap">
              <a
                href={SHOPIFY_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[#D8B07A] text-[#1A1A2E] font-medium px-6 py-3 text-sm hover:bg-[#c9a06a] transition-colors"
                style={{ textDecoration: 'none' }}
              >
                {t('landing.cta.install')}
              </a>
              <a href="#features" className="text-sm text-[#7A6B63] hover:text-[#3A2332] transition-colors">
                {t('landing.cta.howItWorks')}
              </a>
            </div>
            <p style={{ marginTop: 16, fontSize: 12, color: '#A89880' }}>
              {t('landing.hero.trust')}
            </p>
          </div>

          <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', maxWidth: 360 }}>
            <BriefCard />
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="max-w-5xl mx-auto px-6">
        <div className="border-t border-[#E8DDD6]" />
      </div>

      {/* Features */}
      <section id="features" className="max-w-5xl mx-auto px-6 py-20">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#D8B07A] mb-4">
          {t('landing.features.label')}
        </p>
        <h2 className="text-[#3A2332] text-3xl font-semibold tracking-tight mb-12">
          {t('landing.features.title')}
        </h2>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <FeatureCard icon="🧠" title={t('landing.feature1.title')} />
          <FeatureCard icon="⚡" title={t('landing.feature2.title')} />
          <FeatureCard icon="👆" title={t('landing.feature3.title')} />
          <FeatureCard icon="🔄" title={t('landing.feature4.title')} />
        </div>
      </section>

      {/* Divider */}
      <div className="max-w-5xl mx-auto px-6">
        <div className="border-t border-[#E8DDD6]" />
      </div>

      {/* Pricing */}
      <section id="pricing" className="max-w-5xl mx-auto px-6 py-20">
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#D8B07A] mb-4">
            {t('landing.pricing.label')}
          </p>
          <h2 className="text-[#3A2332] text-3xl font-semibold tracking-tight mb-3">
            {t('landing.pricing.title')}
          </h2>
          <p className="text-[#7A6B63] text-base">
            {t('landing.pricing.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
          <PricingCard
            name="Starter"
            price={0}
            period={t('landing.pricing.free')}
            features={[
              t('landing.pricing.starter.f1'),
              t('landing.pricing.starter.f2'),
              t('landing.pricing.starter.f3'),
            ]}
            cta={t('landing.pricing.starter.cta')}
          />
          <PricingCard
            name="Básico"
            price={19}
            period="/mo"
            features={[
              t('landing.pricing.basico.f1'),
              t('landing.pricing.basico.f2'),
              t('landing.pricing.basico.f3'),
              t('landing.pricing.basico.f4'),
            ]}
            cta={t('landing.pricing.basico.cta')}
          />
          <PricingCard
            name="Crecimiento"
            price={39}
            period="/mo"
            highlighted
            features={[
              t('landing.pricing.crecimiento.f1'),
              t('landing.pricing.crecimiento.f2'),
              t('landing.pricing.crecimiento.f3'),
            ]}
            cta={t('landing.pricing.crecimiento.cta')}
          />
          <PricingCard
            name="Pro"
            price={59}
            period="/mo"
            features={[
              t('landing.pricing.pro.f1'),
              t('landing.pricing.pro.f2'),
              t('landing.pricing.pro.f3'),
            ]}
            cta={t('landing.pricing.pro.cta')}
          />
        </div>
        <p style={{ textAlign: 'center', fontSize: 12, color: '#A89880', marginTop: 24 }}>
          {t('landing.pricing.note')}
        </p>
      </section>

      {/* CTA Banner */}
      <div className="max-w-5xl mx-auto px-6 pb-20">
        <div style={{
          background: '#2A1F14',
          borderRadius: 20,
          padding: '48px 40px',
          textAlign: 'center',
        }}>
          <h2 style={{ fontSize: 28, fontWeight: 600, color: '#F5EFE8', marginBottom: 12, fontFamily: "'DM Serif Display', serif" }}>
            {t('landing.bottom.title')}
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(245,239,232,0.6)', marginBottom: 28, maxWidth: 480, margin: '0 auto 28px' }}>
            {t('landing.bottom.desc')}
          </p>
          <a
            href={SHOPIFY_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              background: '#C9964A',
              color: '#2A1F14',
              fontWeight: 600,
              fontSize: 15,
              padding: '14px 32px',
              borderRadius: 10,
              textDecoration: 'none',
              transition: 'opacity 0.15s',
            }}
          >
            {t('landing.bottom.cta')}
          </a>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#E8DDD6]">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-[#7A6B63]">{t('landing.footer.copyright')}</p>
          <div className="flex items-center gap-6">
            <Link to="/privacy" className="text-xs text-[#7A6B63] hover:text-[#3A2332] transition-colors">
              {t('landing.footer.privacy')}
            </Link>
            <Link to="/terms" className="text-xs text-[#7A6B63] hover:text-[#3A2332] transition-colors">
              {t('landing.footer.terms')}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
