import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { AxiosError } from 'axios';
import { AppShell } from '../components/layout/LeftNav';
import { Spinner } from '../components/ui/Spinner';
import { useShopifyConnection } from '../hooks/useShopify';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../contexts/LanguageContext';
import type { Lang } from '../contexts/LanguageContext';
import api from '../lib/api';

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
  const { lang, setLang, t } = useLanguage();

  async function handleLangChange(l: Lang) {
    setLang(l);
    try {
      await api.patch('/api/accounts/language', { language: l });
    } catch {
      // non-fatal: UI already updated
    }
  }

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

  async function handleDisconnect() {
    if (!confirm('Disconnect your Shopify store? This will stop brief generation.')) return;
    await disconnect();
    navigate('/onboarding');
  }

  async function handleGenerateNow() {
    setGenerating(true);
    setGenerateError(null);
    try {
      await api.post('/api/briefs/trigger-now');
      navigate('/dashboard');
    } catch (err) {
      setGenerateError(
        (err as AxiosError<{ error: string }>)?.response?.data?.error ?? 'Something went wrong.'
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleSeedAndGenerate() {
    setSeeding(true);
    setSeedError(null);
    try {
      await api.post('/api/briefs/seed-test-data');
      navigate('/dashboard');
    } catch (err) {
      setSeedError(
        (err as AxiosError<{ error: string }>)?.response?.data?.error ?? 'Something went wrong.'
      );
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
            <SettingRow
              label={t('settings.shopify.noStore')}
              description={t('settings.shopify.noStoreDesc')}
              noBorder
            >
              <ActionButton onClick={() => navigate('/onboarding')}>
                {t('settings.shopify.connect')}
              </ActionButton>
            </SettingRow>
          )}
        </SettingsSection>

        {/* ── Section 2: Brief preferences ── */}
        <SettingsSection label={t('settings.section.preferences')}>
          <SettingRow label={t('settings.delivery.label')} description={t('settings.delivery.desc')}>
            <Badge label={t('settings.badge.comingSoon')} color="var(--ink-faint)" bg="var(--cream-dark)" />
          </SettingRow>
          <SettingRow label={t('settings.lang.label')} description={t('settings.lang.desc')} noBorder>
            <div className="flex items-center gap-1">
              {(['en', 'es'] as Lang[]).map(l => (
                <button
                  key={l}
                  onClick={() => void handleLangChange(l)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: "'DM Sans', sans-serif",
                    cursor: 'pointer',
                    border: lang === l ? '1px solid var(--gold)' : '1px solid rgba(201,150,74,0.25)',
                    background: lang === l ? 'var(--gold)' : 'transparent',
                    color: lang === l ? '#2A1F14' : 'var(--ink-faint)',
                    transition: 'all 0.15s',
                  }}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </SettingRow>
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
              noBorder
            >
              <ActionButton loading={seeding} onClick={handleSeedAndGenerate}>
                {seeding ? t('settings.testing.loading') : t('settings.testing.seedBtn')}
              </ActionButton>
            </SettingRow>
            {(generateError || seedError) && (
              <p style={{ fontSize: 12, color: '#DC2626', paddingTop: 8 }}>
                {generateError ?? seedError}
              </p>
            )}
          </SettingsSection>
        )}

      </div>
    </AppShell>
  );
}
