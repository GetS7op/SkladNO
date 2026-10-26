import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { AUTH_UNAUTHORIZED_EVENT } from '../api/client';
import { identityKeys } from '../../modules/identity/hooks';
import { AuthContext } from './context';
import { loadSession } from './offlineSession';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
