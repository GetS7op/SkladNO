import { LayoutGrid } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useMe } from '../auth/context';
import { navForRole } from '../router/routes';
import { UserMenu } from './UserMenu';

/** Каркас приложения: тёмное боковое меню (как в skladno-pc-old) и рабочая область. */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  return (
    <div className="app-shell">
      <aside className="sidebar no-print">
        <NavLink to="/" className="brand">
          <span className="brand-mark">
            <LayoutGrid size={20} />
          </span>
          <span>
            <strong>SkladNO</strong>
            <span>майнинг-ферма</span>
          </span>
        </NavLink>
        {navForRole(me.role).map((section) => (
          <div key={section.title} className="nav-group">
            <p className="nav-section">{section.title}</p>
            <nav className="primary-nav">
              {section.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className="nav-item">
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        ))}
        <UserMenu />
      </aside>
      <main className="workspace">{children}</main>
    </div>
  );
}
