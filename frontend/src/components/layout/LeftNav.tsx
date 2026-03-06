import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Bell, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAccount } from '../../hooks/useAccount';
import { useUnreadAlerts } from '../../hooks/useUnreadAlerts';
import { useLanguage } from '../../contexts/LanguageContext';
import type { TranslationKey } from '../../locales/en';

const NAV: { icon: LucideIcon; tKey: TranslationKey; to: string; activeOn: string }[] = [
  { icon: LayoutDashboard, tKey: 'nav.dashboard', to: '/dashboard', activeOn: '/dashboard' },
  { icon: BookOpen,        tKey: 'nav.briefs',    to: '/briefs',    activeOn: '/briefs'    },
  { icon: Bell,            tKey: 'nav.alerts',    to: '/alerts',    activeOn: '/alerts'    },
  { icon: Settings,        tKey: 'nav.settings',  to: '/settings',  activeOn: '/settings'  },
];

export function LeftNav() {
  const { pathname } = useLocation();
  const { signOut } = useAuth();
  const { account } = useAccount();
  const navigate = useNavigate();
  const { hasUnread } = useUnreadAlerts(account?.id);
  const { t } = useLanguage();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  const initial = (account?.full_name?.[0] ?? account?.email?.[0] ?? 'S').toUpperCase();

  return (
    <aside
      className="flex-shrink-0 flex flex-col items-center py-6"
      style={{ width: 64, background: '#2A1F14', height: '100%' }}
    >
      {/* Logo */}
      <Link to="/dashboard" className="mb-10 flex items-center justify-center">
        <span
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 700,
            fontSize: 9,
            letterSpacing: '0.35em',
            textTransform: 'uppercase',
            color: '#C9964A',
            writingMode: 'vertical-rl',
          }}
        >
          Sillages
        </span>
      </Link>

      {/* Nav icons */}
      <nav className="flex flex-col items-center gap-1 flex-1">
        {NAV.map(({ icon: Icon, tKey, to, activeOn }) => {
          const active =
            pathname === activeOn || pathname.startsWith(activeOn + '/');
          const showDot = tKey === 'nav.alerts' && hasUnread;
          return (
            <Link
              key={tKey}
              to={to}
              title={t(tKey)}
              style={{
                position: 'relative',
                width: 40,
                height: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                color: active ? '#C9964A' : '#A89880',
                background: active ? 'rgba(201,150,74,0.15)' : 'transparent',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              <Icon size={18} />
              {showDot && (
                <span
                  style={{
                    position: 'absolute',
                    top: 7,
                    right: 7,
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#C9964A',
                    border: '1.5px solid #2A1F14',
                  }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* User avatar — click to sign out */}
      <button
        onClick={handleSignOut}
        title={t('nav.signOut')}
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: '#C9964A',
          color: '#2A1F14',
          fontWeight: 700,
          fontSize: 12,
          fontFamily: "'DM Sans', sans-serif",
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {initial}
      </button>
    </aside>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
      <LeftNav />
      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          background: 'var(--cream)',
        }}
      >
        {children}
      </main>
    </div>
  );
}
