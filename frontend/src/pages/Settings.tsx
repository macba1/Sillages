import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AppShell } from '../components/layout/LeftNav';
import { Spinner } from '../components/ui/Spinner';
import { useShopifyConnection } from '../hooks/useShopify';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../contexts/LanguageContext';
import { usePushNotifications } from '../hooks/usePushNotifications';

// ── Shopify connect form (inline in Settings) ─────────────────────────────────

function ShopifyAdminMock() {
  return (
    <div style={{
      background: '#1a1310', borderRadius: 10, overflow: 'hidden',
      border: '1px solid rgba(201,150,74,0.15)', marginTop: 14, fontSize: 12,
    }}>
      <div style={{ background: '#111', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
        {[0,1,2].map(i => (
          <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'inline-block' }} />
        ))}
        <span style={{ flex: 1, background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '3px 8px', marginLeft: 8, color: 'rgba(42,31,20,0.5)', fontSize: 10 }}>
          admin.shopify.com
        </span>
      </div>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(201,150,74,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 5, background: 'rgba(42,31,20,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 9, color: '#7A6B63' }}>S</span>
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#3A2332', marginBottom: 2 }}>My Store</p>
            <p style={{ fontSize: 10, color: '#C9964A', fontWeight: 500 }}>
              yourstore.myshopify.com
              <span style={{ marginLeft: 6, background: 'rgba(201,150,74,0.12)', border: '1px solid rgba(201,150,74,0.3)', borderRadius: 3, padding: '1px 5px', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#C9964A' }}>
                copy this
              </span>
            </p>
          </div>
        </div>
      </div>
      <div style={{ padding: '8px 14px', display: 'flex', gap: 14, opacity: 0.35 }}>
        {['Home', 'Orders', 'Products', 'Customers'].map(item => (
          <span key={item} style={{ fontSize: 10, color: '#7A6B63' }}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function InlineConnectForm() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [shop, setShop] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  function handleShopChange(raw: string) {
    let val = raw.trim().toLowerCase();
    val = val.replace(/^https?:\/\//, '');
    val = val.replace(/\.myshopify\.com.*$/, '');
    setShop(val);
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const storeName = shop.trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\.myshopify\.com.*$/, '');
    const domain = `${storeName}.myshopify.com`;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setError('Session expired. Please sign in again.'); setLoading(false); return; }
      window.location.href = `${import.meta.env.VITE_API_URL}/api/shopify/auth?shop=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}&app=beta`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  }

  return (
    <div style={{ paddingTop: 16 }}>
      <form onSubmit={handleConnect}>
        {/* Input row */}
        <div className="flex items-center overflow-hidden" style={{
          border: '1px solid rgba(201,150,74,0.3)', borderRadius: 8,
          background: 'var(--white)',
        }}>
          <input
            type="text"
            required
            value={shop}
            onChange={e => handleShopChange(e.target.value)}
            placeholder={t('onboarding.connect.placeholder')}
            style={{
              flex: 1, padding: '10px 14px',
              background: 'transparent', color: 'var(--ink)',
              fontSize: 14, fontFamily: "'DM Sans', sans-serif",
              border: 'none', outline: 'none',
            }}
          />
          <span style={{ padding: '10px 12px', fontSize: 13, color: 'var(--ink-faint)', borderLeft: '1px solid rgba(201,150,74,0.2)', whiteSpace: 'nowrap' }}>
            .myshopify.com
          </span>
        </div>

        {/* Helper text */}
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 6, lineHeight: 1.5 }}>
          {t('onboarding.connect.helper')}
        </p>

        {/* Collapsible help */}
        <div style={{ marginTop: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setHelpOpen(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: 13, color: 'var(--gold)', fontFamily: "'DM Sans', sans-serif",
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <span style={{
              display: 'inline-block', width: 10, height: 10,
              borderRight: '1.5px solid var(--gold)', borderBottom: '1.5px solid var(--gold)',
              transform: helpOpen ? 'rotate(-135deg) translateY(-2px)' : 'rotate(45deg)',
              transition: 'transform 0.2s ease',
            }} />
            {t('onboarding.connect.whereToggle')}
          </button>

          {helpOpen && (
            <div style={{
              marginTop: 14, padding: '14px 16px',
              background: 'var(--cream)', border: '1px solid rgba(201,150,74,0.15)',
              borderRadius: 10,
            }}>
              <p style={{ fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: 12 }}>
                {t('onboarding.connect.whereBody')}
              </p>
              <ol style={{ paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(['whereStep1', 'whereStep2', 'whereStep3', 'whereStep4'] as const).map((key, i) => (
                  <li key={key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{
                      flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
                      border: '1px solid rgba(201,150,74,0.4)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700, color: 'var(--gold)', marginTop: 1,
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
                      {t(`onboarding.connect.${key}`)}
                    </span>
                  </li>
                ))}
              </ol>
              <ShopifyAdminMock />
            </div>
          )}
        </div>

        {error && <p style={{ fontSize: 12, color: '#DC2626', marginBottom: 12 }}>{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
              border: '1px solid rgba(201,150,74,0.3)',
              background: 'var(--ink)', color: 'var(--cream)',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {loading && <span style={{ width: 12, height: 12, border: '2px solid var(--cream)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />}
            {loading ? t('onboarding.connect.loading') : t('onboarding.connect.btn')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/onboarding')}
            style={{ fontSize: 13, color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
          >
            Use setup wizard →
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Primitives ───────────────────────────────────────────────────────────────

function SettingsSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 48 }}>
      <div className="flex items-center gap-3" style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gold)', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(201,150,74,0.2)' }} />
      </div>
      {children}
    </section>
  );
}

function SettingRow({
  label,
  description,
  children,
  noBorder = false,
}: {
  label: string;
  description?: string;
  children?: React.ReactNode;
  noBorder?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4"
      style={{
        padding: '16px 0',
        borderBottom: noBorder ? 'none' : '1px solid rgba(201,150,74,0.1)',
      }}
    >
      <div>
        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{label}</p>
        {description && (
          <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>{description}</p>
        )}
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>
  );
}

function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color, background: bg, padding: '3px 9px', borderRadius: 4 }}>
      {label}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  loading: isLoading,
  variant = 'default',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  loading?: boolean;
  variant?: 'default' | 'danger';
}) {
  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      style={{
        padding: '7px 16px',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "'DM Sans', sans-serif",
        border: variant === 'danger' ? '1px solid #FCA5A5' : '1px solid rgba(201,150,74,0.3)',
        background: variant === 'danger' ? '#FEF2F2' : 'var(--white)',
        color: variant === 'danger' ? '#DC2626' : 'var(--ink)',
        cursor: isLoading ? 'not-allowed' : 'pointer',
        opacity: isLoading ? 0.6 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        transition: 'opacity 0.15s',
      }}
    >
      {isLoading && (
        <span style={{ width: 12, height: 12, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
      )}
      {children}
    </button>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Settings() {
  const { connection, loading: connLoading, disconnect } = useShopifyConnection();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const push = usePushNotifications();

  // Email / isTony
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userEmailReady, setUserEmailReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user?.email ?? null;
      setUserEmail(email);
      setUserEmailReady(true);
    });
  }, []);

  const isTony =
    userEmailReady &&
    (userEmail === 'tony@richmondpartner.com' || userEmail === 'tony@bitext.com');

  // Admin actions
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [runningScheduler, setRunningScheduler] = useState(false);
  const [schedulerResult, setSchedulerResult] = useState<{ processed: string[]; count: number } | null>(null);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);

  async function handleDisconnect() {
    if (!confirm('Disconnect your Shopify store? This will stop brief generation.')) return;
    await disconnect();
    navigate('/onboarding');
  }

  async function handleGenerateNow() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/briefs/trigger-now`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? 'Something went wrong.');
      }
      navigate('/dashboard');
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleRunScheduler() {
    setRunningScheduler(true);
    setSchedulerResult(null);
    setSchedulerError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/run-scheduler`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      });
      const body = await res.json() as { ok?: boolean; processed?: string[]; count?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Something went wrong.');
      setSchedulerResult({ processed: body.processed ?? [], count: body.count ?? 0 });
    } catch (err) {
      setSchedulerError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setRunningScheduler(false);
    }
  }

  async function handleSeedAndGenerate() {
    setSeeding(true);
    setSeedError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/briefs/seed-test-data`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? 'Something went wrong.');
      }
      navigate('/dashboard');
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSeeding(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '64px 32px 80px' }}>

        {/* Title */}
        <h1
          className="font-display fade-up"
          style={{ fontSize: 32, color: 'var(--ink)', marginBottom: 48 }}
        >
          {t('settings.title')}
        </h1>

        {/* ── Section 1: Shopify connection ── */}
        <SettingsSection label={t('settings.section.shopify')}>
          {connLoading ? (
            <div className="flex" style={{ padding: '20px 0' }}>
              <Spinner size="sm" />
            </div>
          ) : connection ? (
            <>
              <SettingRow
                label={connection.shop_name ?? connection.shop_domain}
                description={connection.shop_domain}
              >
                <div className="flex items-center gap-3">
                  <Badge label={t('settings.shopify.connected')} color="var(--green)" bg="var(--green-bg)" />
                  <ActionButton variant="danger" onClick={handleDisconnect}>
                    {t('settings.shopify.disconnect')}
                  </ActionButton>
                </div>
              </SettingRow>
              <SettingRow
                label={t('settings.shopify.briefsNightly')}
                description={t('settings.shopify.briefsDesc')}
                noBorder
              />
            </>
          ) : (
            <div style={{ padding: '16px 0' }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', marginBottom: 4 }}>
                {t('settings.shopify.noStore')}
              </p>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 0 }}>
                {t('settings.shopify.noStoreDesc')}
              </p>
              <InlineConnectForm />
            </div>
          )}
        </SettingsSection>

        {/* ── Section 2: Brief preferences ── */}
        <SettingsSection label={t('settings.section.preferences')}>
          <SettingRow label={t('settings.delivery.label')} description={t('settings.delivery.desc')} noBorder>
            <Badge label={t('settings.badge.comingSoon')} color="var(--ink-faint)" bg="var(--cream-dark)" />
          </SettingRow>

          {push.state !== 'unsupported' && (
            <SettingRow
              label="Push notifications"
              description={
                push.state === 'subscribed'
                  ? 'Tu brief diario llega como notificación push'
                  : push.state === 'denied'
                    ? 'Bloqueadas en el navegador — actívalas en la configuración del navegador'
                    : 'Recibe tu brief diario como notificación push'
              }
              noBorder
            >
              {push.state === 'subscribed' ? (
                <ActionButton onClick={() => void push.unsubscribe()}>
                  Desactivar
                </ActionButton>
              ) : push.state === 'prompt' ? (
                <ActionButton onClick={() => void push.subscribe()}>
                  Activar
                </ActionButton>
              ) : push.state === 'denied' ? (
                <Badge label="Bloqueadas" color="#DC2626" bg="#FEF2F2" />
              ) : null}
            </SettingRow>
          )}
        </SettingsSection>

        {/* ── Section 3: Plan ── */}
        <SettingsSection label={t('settings.section.plan')}>
          <SettingRow
            label={t('settings.plan.free')}
            description={t('settings.plan.freeDesc')}
            noBorder
          >
            <Badge label={t('settings.badge.beta')} color="var(--green)" bg="var(--green-bg)" />
          </SettingRow>
        </SettingsSection>

        {/* ── Section 4: Account ── */}
        <SettingsSection label={t('settings.section.account')}>
          <SettingRow label={userEmail ?? '—'} description={t('settings.account.emailDesc')} noBorder>
            <ActionButton onClick={handleSignOut}>
              {t('settings.account.signOut')}
            </ActionButton>
          </SettingRow>
        </SettingsSection>

        {/* ── Admin: Testing (isTony only) ── */}
        {isTony && (
          <SettingsSection label={t('settings.section.testing')}>
            <SettingRow
              label={t('settings.testing.generateLabel')}
              description={t('settings.testing.generateDesc')}
            >
              <ActionButton loading={generating} onClick={handleGenerateNow}>
                {generating ? t('settings.testing.generating') : t('settings.testing.generateBtn')}
              </ActionButton>
            </SettingRow>
            <SettingRow
              label={t('settings.testing.seedLabel')}
              description={t('settings.testing.seedDesc')}
            >
              <ActionButton loading={seeding} onClick={handleSeedAndGenerate}>
                {seeding ? t('settings.testing.loading') : t('settings.testing.seedBtn')}
              </ActionButton>
            </SettingRow>
            <SettingRow
              label="Run scheduler now"
              description="Force-run the nightly brief pipeline for all accounts, ignoring send hour."
              noBorder
            >
              <ActionButton loading={runningScheduler} onClick={handleRunScheduler}>
                {runningScheduler ? 'Running…' : 'Run scheduler'}
              </ActionButton>
            </SettingRow>
            {schedulerResult && (
              <div style={{ fontSize: 12, color: 'var(--green)', paddingTop: 8, lineHeight: 1.6 }}>
                ✓ Ran for {schedulerResult.count} account(s)
                {schedulerResult.count > 0 && (
                  <span style={{ color: 'var(--ink-faint)', marginLeft: 6 }}>
                    — {schedulerResult.processed.join(', ')}
                  </span>
                )}
              </div>
            )}
            {(generateError || seedError || schedulerError) && (
              <p style={{ fontSize: 12, color: '#DC2626', paddingTop: 8 }}>
                {generateError ?? seedError ?? schedulerError}
              </p>
            )}
          </SettingsSection>
        )}

      </div>
    </AppShell>
  );
}
