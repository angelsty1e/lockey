import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Lock,
  ClipboardList,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, exact: true },
  { to: '/vault', label: 'Lockey', icon: Lock },
  { to: '/audit', label: 'Journal', icon: ClipboardList, adminOnly: true },
  { to: '/settings', label: 'Paramètres', icon: Settings, adminOnly: true },
];

export function Sidebar({ id }: { id?: string } = {}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  return (
    <aside className="sidebar" id={id}>
      <div className="brand">
        <div className="brand-mark">
          <span className="brand-mark-cyan">Lockey</span>
        </div>
      </div>

      <nav className="nav">
        {navItems.filter(item => !item.adminOnly || isAdmin).map(item => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
              <Icon className="nav-icon" aria-hidden="true" strokeWidth={1.75} />
              <span className="nav-label">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
