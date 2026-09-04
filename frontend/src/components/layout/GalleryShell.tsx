import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Images, Palette, Eye, Rocket, BarChart3, CreditCard } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAccount } from '../../hooks/useAccount';

/**
 * Navigation for the new product (PRODUCT_MODE=social_gallery).
 *
 * Sprint 0 ships the shell only — every destination is a placeholder screen.
 * Legacy destinations (Dashboard, Briefs, Alerts, Actions, Chat, Tower) are
 * deliberately absent.
 */
export const GALLERY_NAV: { icon: LucideIcon; label: string; to: string }[] = [
  { icon: Images,     label: 'Collections',  to: '/collections'  },
  { icon: Palette,    label: 'Design',       to: '/design'       },
  { icon: Eye,        label: 'Preview',      to: '/preview'      },
  { icon: Rocket,     label: 'Publish',      to: '/publish'      },
  { icon: BarChart3,  label: 'Performance',  to: '/performance'  },
  { icon: CreditCard, label: 'Plan',         to: '/plan'         },
];

function GalleryNav() {
  const { pathname } = useLocation();
  const { signOut } = useAuth();
  const { account } = useAccount();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  const initial = (account?.full_name?.[0] ?? account?.email?.[0] ?? 'S').toUpperCase();

  return (
    <aside
      className="flex-shrink-0 flex flex-col py-6"
      style={{ width: 208, background: '#2A1F14', height: '100%' }}
    >
      <Link to="/collections" className="mb-8 px-5 flex items-center">
        <span
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '0.35em',
            textTransform: 'uppercase',
            color: '#C9964A',
          }}
        >
          Sillages
        </span>
      </Link>

      <nav className="flex flex-col gap-1 flex-1 px-3">
        {GALLERY_NAV.map(({ icon: Icon, label, to }) => {
          const active = pathname === to || pathname.startsWith(to + '/');
          return (
            <Link
              key={to}
              to={to}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 10,
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active ? '#C9964A' : '#A89880',
                background: active ? 'rgba(201,150,74,0.15)' : 'transparent',
                textDecoration: 'none',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              <Icon size={17} />
              {label}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={handleSignOut}
        title="Sign out"
        style={{
          margin: '0 12px',
          padding: '9px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderRadius: 10,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: '#A89880',
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 13,
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: '#C9964A',
            color: '#2A1F14',
            fontWeight: 700,
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {initial}
        </span>
        Sign out
      </button>
    </aside>
  );
}

export function GalleryShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
      <GalleryNav />
      <main style={{ flex: 1, overflowY: 'auto', background: 'var(--cream)' }}>{children}</main>
    </div>
  );
}
