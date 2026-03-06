import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAccount } from '../hooks/useAccount';
import { useLanguage } from '../contexts/LanguageContext';
import type { Lang } from '../contexts/LanguageContext';
import api from '../lib/api';

// ── Step sub-components ───────────────────────────────────────────────────────

function NumberedStep({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-start gap-4">
      <div
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: 32, height: 32, borderRadius: '50%',
          border: '1.5px solid rgba(201,150,74,0.5)',
          marginTop: 2,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: '#C9964A' }}>{n}</span>
      </div>
      <p style={{ fontSize: 15, fontWeight: 300, color: 'rgba(245,239,232,0.65)', lineHeight: 1.75, paddingTop: 4 }}>
        {text}
      </p>
    </div>
  );
}

function WelcomeScreen({ firstName, onNext }: { firstName: string; onNext: () => void }) {
  const { t } = useLanguage();

  return (
    <>
      <h1
        className="font-display fade-up"
        style={{ fontSize: 42, color: '#F5EFE8', lineHeight: 1.15, marginBottom: 24 }}
      >
        {t('onboarding.welcome.hi', { firstName })}<br />{t('onboarding.welcome.sub')}
      </h1>

      <p
        className="fade-up-2"
        style={{ fontSize: 16, fontWeight: 300, color: 'rgba(245,239,232,0.6)', lineHeight: 1.75, marginBottom: 48 }}
      >
        {t('onboarding.welcome.body')}
      </p>

      <div className="flex flex-col gap-5 fade-up-3" style={{ marginBottom: 48 }}>
        <NumberedStep n={1} text={t('onboarding.step1')} />
        <NumberedStep n={2} text={t('onboarding.step2')} />
        <NumberedStep n={3} text={t('onboarding.step3')} />
      </div>

      <div className="fade-up-4">
        <button
          onClick={onNext}
          style={{
            background: '#C9964A', color: '#2A1F14',
            border: 'none', borderRadius: 8,
            padding: '14px 28px', fontSize: 15, fontWeight: 600,
            fontFamily: "'DM Sans', sans-serif",
            cursor: 'pointer', transition: 'opacity 0.15s',
          }}
        >
          {t('onboarding.cta')}
        </button>

        <p style={{ marginTop: 16, fontSize: 12, color: 'rgba(245,239,232,0.3)' }}>
          {t('onboarding.beta')}
        </p>
      </div>
    </>
  );
}

function ConnectScreen({ onBack }: { onBack: () => void }) {
  const { t } = useLanguage();
  const [shop, setShop] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let domain = shop.trim().toLowerCase();
    if (!domain.endsWith('.myshopify.com')) {
      domain = `${domain}.myshopify.com`;
    }

    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setError('Session expired. Please sign in again.');
        setLoading(false);
        return;
      }
      window.location.href = `${import.meta.env.VITE_API_URL}/api/shopify/auth?shop=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  }

  return (
    <div className="fade-up">
      <button
        onClick={onBack}
        style={{
          fontSize: 13, color: 'rgba(245,239,232,0.4)',
          background: 'none', border: 'none', cursor: 'pointer',
          marginBottom: 32, padding: 0,
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {t('onboarding.connect.back')}
      </button>

      <h2
        className="font-display"
        style={{ fontSize: 32, color: '#F5EFE8', marginBottom: 12, lineHeight: 1.2 }}
      >
        {t('onboarding.connect.title')}
      </h2>
      <p style={{ fontSize: 14, fontWeight: 300, color: 'rgba(245,239,232,0.5)', marginBottom: 32, lineHeight: 1.65 }}>
        {t('onboarding.connect.desc')}
      </p>

      <form onSubmit={handleConnect}>
        <div
          className="flex items-center overflow-hidden"
          style={{
            border: '1px solid rgba(201,150,74,0.3)',
            borderRadius: 8, marginBottom: 16,
            background: 'rgba(245,239,232,0.04)',
          }}
        >
          <input
            type="text"
            required
            value={shop}
            onChange={e => setShop(e.target.value)}
            placeholder="your-store"
            style={{
              flex: 1, padding: '12px 14px',
              background: 'transparent', color: '#F5EFE8',
              fontSize: 14, fontFamily: "'DM Sans', sans-serif",
              border: 'none', outline: 'none',
            }}
          />
          <span style={{ padding: '12px 14px', fontSize: 13, color: 'rgba(245,239,232,0.3)', borderLeft: '1px solid rgba(201,150,74,0.2)', whiteSpace: 'nowrap' }}>
            .myshopify.com
          </span>
        </div>

        {error && (
          <p style={{ fontSize: 13, color: '#FF7B7B', marginBottom: 16 }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            background: loading ? 'rgba(201,150,74,0.5)' : '#C9964A',
            color: '#2A1F14', border: 'none', borderRadius: 8,
            padding: '13px', fontSize: 15, fontWeight: 600,
            fontFamily: "'DM Sans', sans-serif",
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {loading && (
            <span style={{ width: 14, height: 14, border: '2px solid #2A1F14', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
          )}
          {loading ? t('onboarding.connect.loading') : t('onboarding.connect.btn')}
        </button>
      </form>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Onboarding() {
  const { account } = useAccount();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const { lang, setLang } = useLanguage();

  async function handleLangChange(l: Lang) {
    setLang(l);
    try { await api.patch('/api/accounts/language', { language: l }); } catch { /* non-fatal */ }
  }

  // Handle legacy ?connected=true redirects
  if (new URLSearchParams(window.location.search).get('connected') === 'true') {
    setTimeout(() => navigate('/dashboard'), 100);
    return null;
  }

  const firstName = account?.full_name?.split(' ')[0] ?? 'there';

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#2A1F14',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        position: 'relative',
      }}
    >
      {/* Language toggle — top right */}
      <div
        className="flex items-center gap-1"
        style={{ position: 'absolute', top: 24, right: 24 }}
      >
        {(['en', 'es'] as Lang[]).map(l => (
          <button
            key={l}
            onClick={() => void handleLangChange(l)}
            style={{
              padding: '4px 10px',
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif",
              letterSpacing: '0.08em',
              cursor: 'pointer',
              border: 'none',
              background: lang === l ? 'rgba(201,150,74,0.2)' : 'transparent',
              color: lang === l ? '#C9964A' : 'rgba(245,239,232,0.3)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ width: '100%', maxWidth: 520 }}>
        {step === 0 ? (
          <WelcomeScreen firstName={firstName} onNext={() => setStep(1)} />
        ) : (
          <ConnectScreen onBack={() => setStep(0)} />
        )}
      </div>
    </div>
  );
}
