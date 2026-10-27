import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { AUTH_UNAUTHORIZED_EVENT } from '../api/client';
import { identityKeys } from '../../modules/identity/hooks';
import type { Role } from '../domain';
import { AuthContext } from './context';
import { loadSession } from './offlineSession';

const VIEW_ROLE_KEY = 'skladno.viewRole';

/** Выбранный вид роли живёт до закрытия вкладки, чтобы администратор не застрял в чужом виде. */
function loadViewRole(): Role | null {
  try {
    return (sessionStorage.getItem(VIEW_ROLE_KEY) as Role | null) ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [viewRole, setViewRoleState] = useState(loadViewRole);
  const setViewRole = (role: Role | null) => {
    setViewRoleState(role);
    try {
      if (role) sessionStorage.setItem(VIEW_ROLE_KEY, role);
      else sessionStorage.removeItem(VIEW_ROLE_KEY);
    } catch {
      // Без хранилища вид сбросится при перезагрузке страницы.
    }
  };
  const session = useQuery({
    queryKey: identityKeys.session,
    queryFn: loadSession,
    staleTime: Infinity,
  });

  useEffect(() => {
    // 401 на любом запросе — сессия истекла или пользователя отключили: перепроверяем.
    const recheck = () => void queryClient.invalidateQueries({ queryKey: identityKeys.session });
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, recheck);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, recheck);
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{
        checking: session.isPending,
        error: session.error,
        retry: () => void session.refetch(),
        needsSetup: session.data?.needs_setup ?? false,
        user: session.data?.user ?? null,
        viewRole,
        setViewRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
