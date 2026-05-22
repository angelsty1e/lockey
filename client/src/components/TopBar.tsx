import { LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ThemeToggle } from './ThemeToggle';

export function TopBar() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <header className="topbar" role="banner">
      <div className="topbar-spacer" />
      <div className="topbar-actions">
        <ThemeToggle />
        <div className="topbar-user">
          <div className="user-avatar topbar-avatar">{user.username[0]?.toUpperCase()}</div>
          <div className="topbar-user-info">
            <div className="topbar-user-name">{user.username}</div>
          </div>
        </div>
        <button
          className="topbar-logout"
          onClick={logout}
          aria-label="Déconnexion"
          title="Déconnexion"
        >
          <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
