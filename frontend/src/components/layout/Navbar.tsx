import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Settings } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

export function Navbar() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-[#F7F1EC] border-b border-[#E8DDD6] flex items-center justify-between px-6">
      <Link
        to="/dashboard"
        className="text-[#3A2332] font-semibold tracking-tight text-base"
      >
        sillages
      </Link>

      <nav className="flex items-center gap-0.5">
        <Link
          to="/settings"
          className="p-2 text-[#7A6B63] hover:text-[#3A2332] transition-colors"
          title="Settings"
        >
          <Settings size={16} />
        </Link>
        <button
          onClick={handleSignOut}
          className="p-2 text-[#7A6B63] hover:text-[#3A2332] transition-colors"
          title="Sign out"
        >
          <LogOut size={16} />
        </button>
      </nav>
    </header>
  );
}
