import { Outlet } from 'react-router-dom';
import { AppShell } from './AppShell';
import { OfflineBanner } from './OfflineBanner';

/** Защищённая часть приложения: меню, плашка «нет связи» и страница раздела. */
export function WorkspaceLayout() {
  return (
    <AppShell>
      <OfflineBanner />
      <Outlet />
    </AppShell>
  );
}
