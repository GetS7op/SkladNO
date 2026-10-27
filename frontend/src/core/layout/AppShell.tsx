import { LayoutGrid, Menu, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useMe } from '../auth/context';
import { navForRole, navItemFromPathname } from '../router/routes';
import { UserMenu } from './UserMenu';

/**
 * Каркас приложения: тёмное боковое меню (как в skladno-pc-old) и рабочая область.
 * На узком экране (ТСД, телефон) меню свёрнуто в шапку с названием раздела и раскрывается кнопкой.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const current = navItemFromPathname(pathname);

  return (
    <div className="app-shell">
      <aside className={`sidebar no-print${open ? ' open' : ''}`}>
        <div className="sidebar-top">
          <NavLink to="/" className="brand" onClick={close}>
            <span className="brand-mark">
              <LayoutGrid size={20} />
            </span>
            <span>
              <strong>SkladNO</strong>
              <span>майнинг-ферма</span>
            </span>
          </NavLink>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={open}
            aria-label={open ? 'Свернуть меню' : 'Открыть меню'}
            onClick={() => setOpen(!open)}
          >
            <span>{current?.label ?? 'Меню'}</span>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        <div className="sidebar-body">
          {navForRole(me.role).map((section) => (
            <div key={section.title} className="nav-group">
              <p className="nav-section">{section.title}</p>
              <nav className="primary-nav">
                {section.items.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} className="nav-item" onClick={close}>
                    <Icon size={18} />
                    {label}
                  </NavLink>
                ))}
              </nav>
            </div>
          ))}
          <UserMenu />
        </div>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  );
}
