import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Zap, MessageCircle, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useUnreadAlerts } from '../../hooks/useUnreadAlerts';
import { useAccount } from '../../hooks/useAccount';
import { useActionStats } from '../../hooks/useActions';

const TABS: { icon: LucideIcon; label: string; to: string; match: string }[] = [
  { icon: LayoutDashboard, label: 'Home',     to: '/dashboard', match: '/dashboard' },
  { icon: BookOpen,        label: 'Briefs',   to: '/briefs',    match: '/briefs'    },
  { icon: Zap,             label: 'Actions',  to: '/actions',   match: '/actions'   },
  { icon: MessageCircle,   label: 'Chat',     to: '/chat',      match: '/chat'      },
  { icon: Settings,        label: 'Settings', to: '/settings',  match: '/settings'  },
];

export function MobileTabBar() {
  const { pathname } = useLocation();
  const { account } = useAccount();
  const { hasUnread } = useUnreadAlerts(account?.id);
  const actionStats = useActionStats(account?.id);
  const pendingCount = actionStats.pending;

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 900,
        background: 'rgba(250,246,241,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(201,150,74,0.15)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        height: 56,
      }}>
        {TABS.map(({ icon: Icon, label, to, match }) => {
          const active = pathname === match || pathname.startsWith(match + '/');
          const showDot = label === 'Briefs' && hasUnread;
          const showBadge = label === 'Actions' && pendingCount > 0;
          return (
            <Link
              key={to}
              to={to}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                textDecoration: 'none',
                position: 'relative',
                padding: '4px 16px',
                transition: 'color 0.15s',
              }}
            >
              <Icon
                size={22}
                style={{
                  color: active ? '#C9964A' : '#A89880',
                  transition: 'color 0.15s',
                }}
              />
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                color: active ? '#C9964A' : '#A89880',
                letterSpacing: '0.02em',
              }}>
                {label}
              </span>
              {showDot && (
                <span style={{
                  position: 'absolute',
                  top: 2,
                  right: 12,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#C9964A',
                }} />
              )}
              {showBadge && (
                <span style={{
                  position: 'absolute',
                  top: 0,
                  right: 8,
                  minWidth: 16,
                  height: 16,
                  borderRadius: 8,
                  background: '#C9964A',
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                }}>
                  {pendingCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
