import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../contexts/LanguageContext';
import { Spinner } from '../components/ui/Spinner';
import { supabase } from '../lib/supabase';

/**
 * /reconnect — One-click Shopify reconnection.
 * Detects the user's account, grabs their existing shop_domain,
 * and redirects straight to the Shopify OAuth flow.
 */
export default function Reconnect() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      // Not logged in — redirect to login with return URL
      window.location.href = '/login?redirect=/reconnect';
      return;
    }

    // Get auth token and redirect to backend reconnect endpoint
    async function doReconnect() {
      try {
        setRedirecting(true);
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (!token) {
          setError('No auth session found. Please log in again.');
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

    doReconnect();
  }, [user, authLoading]);

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#F7F1EC',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        maxWidth: 400,
        textAlign: 'center',
      }}>
        {(authLoading || redirecting) && !error && (
          <>
            <Spinner size="lg" />
            <p style={{ color: '#2A1F14', fontSize: 15, marginTop: 20 }}>
              {t('reconnect.redirecting')}
            </p>
          </>
        )}

        {error && (
          <div style={{
            padding: '20px 24px',
            borderRadius: 12,
            background: 'rgba(211,84,0,0.08)',
            color: '#D35400',
            fontSize: 14,
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
