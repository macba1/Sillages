import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../contexts/LanguageContext';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { supabase } from '../lib/supabase';

/**
 * /reconnect — One-click Shopify reconnection.
 * If not logged in, shows inline login form (no redirect).
 * After login, automatically starts OAuth flow.
 */
export default function Reconnect() {
  const { user, loading: authLoading, signInWithEmail } = useAuth();
  const { t } = useLanguage();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // Inline login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Start OAuth flow
  async function doReconnect() {
    try {
      setRedirecting(true);
      setError(null);
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setError(t('reconnect.noSession'));
        setRedirecting(false);
        return;
      }

      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      window.location.href = `${apiUrl}/api/shopify/reconnect?token=${encodeURIComponent(token)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reconnect');
      setRedirecting(false);
    }
  }

  // Auto-start reconnect when user is authenticated
  useEffect(() => {
    if (authLoading) return;
    if (user) {
      doReconnect();
    }
  }, [user, authLoading]);

  // Inline login handler
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      await signInWithEmail(email, password);
      // useAuth will update `user`, which triggers the useEffect above → doReconnect()
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed');
      setLoginLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#F7F1EC',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
        {/* Logo */}
        <div style={{ marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: '#2A1F14',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: '#C9964A', fontSize: 24, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>S</span>
          </div>
        </div>

        {/* Loading / Redirecting state */}
        {(authLoading || redirecting) && !error && (
          <>
            <Spinner size="lg" />
            <p style={{ color: '#2A1F14', fontSize: 15, marginTop: 20 }}>
              {t('reconnect.redirecting')}
            </p>
          </>
        )}

        {/* Inline login form — shown when not authenticated */}
        {!authLoading && !user && !redirecting && (
          <div style={{
            background: '#fff',
            border: '1px solid #E8DDD6',
            padding: '32px 28px',
            textAlign: 'left',
          }}>
            <h2 style={{
              color: '#2A1F14', fontSize: 18, fontWeight: 600,
              margin: '0 0 6px', fontFamily: "'DM Sans', sans-serif",
            }}>
              {t('reconnect.loginTitle')}
            </h2>
            <p style={{ color: '#7A6B63', fontSize: 14, margin: '0 0 24px', lineHeight: 1.5 }}>
              {t('reconnect.loginDesc')}
            </p>

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: 16 }}>
                <label style={{
                  display: 'block', fontSize: 11, fontWeight: 600,
                  color: '#7A6B63', textTransform: 'uppercase', letterSpacing: '0.1em',
                  marginBottom: 6,
                }}>
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                  placeholder="tu@email.com"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{
                  display: 'block', fontSize: 11, fontWeight: 600,
                  color: '#7A6B63', textTransform: 'uppercase', letterSpacing: '0.1em',
                  marginBottom: 6,
                }}>
                  {t('reconnect.password')}
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  placeholder="••••••••"
                  style={{ width: '100%' }}
                />
              </div>

              {loginError && (
                <p style={{
                  fontSize: 13, color: '#D35400',
                  background: 'rgba(211,84,0,0.06)', padding: '10px 14px',
                  borderRadius: 8, marginBottom: 16,
                }}>
                  {loginError}
                </p>
              )}

              <Button type="submit" loading={loginLoading} className="w-full">
                {t('reconnect.loginBtn')}
              </Button>
            </form>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div style={{
            padding: '20px 24px',
            borderRadius: 12,
            background: 'rgba(211,84,0,0.08)',
            color: '#D35400',
            fontSize: 14,
            marginTop: 16,
          }}>
            {error}
            <br />
            <a
              href="/settings"
              style={{ color: '#C9964A', fontWeight: 600, marginTop: 12, display: 'inline-block' }}
            >
              {t('reconnect.goSettings')}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
