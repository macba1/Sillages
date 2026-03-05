import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAccount } from '../hooks/useAccount';

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
  return (
    <>
      <h1
        className="font-display fade-up"
        style={{ fontSize: 42, color: '#F5EFE8', lineHeight: 1.15, marginBottom: 24 }}
      >
        Hi {firstName}, I'm Sillages —<br />your personal store agent.
      </h1>

      <p
        className="fade-up-2"
        style={{ fontSize: 16, fontWeight: 300, color: 'rgba(245,239,232,0.6)', lineHeight: 1.75, marginBottom: 48 }}
      >
        I know exactly how you feel. We have a store, we see the numbers, but we
        don't really understand why some days go well and others don't. Too much
        data, too many screens, too many things we're supposedly supposed to be
        doing. I take care of that.
      </p>

      <div className="flex flex-col gap-5 fade-up-3" style={{ marginBottom: 48 }}>
        <NumberedStep n={1} text="Every morning I'll tell you what happened in our store" />
        <NumberedStep n={2} text="I work every night while you sleep — no setup needed" />
        <NumberedStep n={3} text="I just need read-only access to our Shopify store to get started" />
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
          Let's get to work →
        </button>

        <p style={{ marginTop: 16, fontSize: 12, color: 'rgba(245,239,232,0.3)' }}>
          Free during beta · No credit card · Cancel anytime
        </p>
      </div>
    </>
  );
}

function ConnectScreen({ onBack }: { onBack: () => void }) {
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
        ← Back
      </button>

      <h2
        className="font-display"
        style={{ fontSize: 32, color: '#F5EFE8', marginBottom: 12, lineHeight: 1.2 }}
      >
        Connect our store
      </h2>
      <p style={{ fontSize: 14, fontWeight: 300, color: 'rgba(245,239,232,0.5)', marginBottom: 32, lineHeight: 1.65 }}>
        You'll be redirected to Shopify to approve read-only access. I never modify your data.
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
          {loading ? 'Connecting…' : 'Connect store'}
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
      }}
    >
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
