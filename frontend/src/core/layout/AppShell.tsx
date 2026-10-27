import { ChevronDown, Eye, LayoutGrid, Menu, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth, useRole } from '../auth/context';
import { roleLabel } from '../domain';
import { NAV_HOME, navForRole, navItemFromPathname, navSectionFromPathname } from '../router/routes';
import { UserMenu } from './UserMenu';

const SECTIONS_KEY = 'skladno.nav.sections';

/** Какие разделы меню пользователь раскрыл или свернул сам (запоминается в браузере). */
function loadSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

/**
 * Каркас приложения: тёмное боковое меню (как в skladno-pc-old) и рабочая область.
 * Меню собрано в разделы с подпунктами: раздел открытой страницы раскрыт, остальные — по клику.
 * На узком экране (ТСД, телефон) меню свёрнуто в шапку с названием раздела и раскрывается кнопкой.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const role = useRole();
  const { viewRole, setViewRole } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState(loadSections);
  const close = () => setOpen(false);
  const current = navItemFromPathname(pathname);
  const currentSection = navSectionFromPathname(pathname);

  const toggleSection = (title: string, expanded: boolean) => {
    const next = { ...sections, [title]: !expanded };
    setSections(next);
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
    } catch {
      // Без хранилища меню просто не запомнит выбор.
    }
  };

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
          <nav className="primary-nav">
            <NavLink to={NAV_HOME.to} className="nav-item nav-home" onClick={close}>
              <NAV_HOME.icon size={18} />
              {NAV_HOME.label}
            </NavLink>
            {navForRole(role).map(({ title, icon: SectionIcon, items }) => {
              const active = currentSection?.title === title;
              // Раздел открытой страницы раскрыт, пока его не свернули вручную.
              const expanded = sections[title] ?? active;
              const id = `nav-${title}`;
              return (
                <div key={title} className={`nav-group${expanded ? ' expanded' : ''}`}>
                  <button
                    type="button"
                    className={`nav-section${active ? ' active' : ''}`}
                    aria-expanded={expanded}
                    aria-controls={id}
                    onClick={() => toggleSection(title, expanded)}
                  >
                    <SectionIcon size={18} />
                    <span>{title}</span>
                    <ChevronDown size={16} className="chevron" />
                  </button>
                  {expanded && (
                    <div id={id} className="nav-items">
                      {items.map(({ to, label, icon: Icon }) => (
                        <NavLink key={to} to={to} className="nav-item" onClick={close}>
                          <Icon size={16} />
                          {label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          <UserMenu />
        </div>
      </aside>
      <main className="workspace">
        {viewRole && (
          <div className="banner view-role-banner no-print">
            <Eye size={16} />
            <span>
              Вид роли «{roleLabel(viewRole)}»: меню и кнопки — как у этой роли. Действия по-прежнему
              выполняются с правами администратора.
            </span>
            <button type="button" className="btn" onClick={() => setViewRole(null)}>
              Вернуть вид администратора
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
