import { createContext, useContext } from 'react';
import { hasRole, type Role } from '../domain';
import type { Me } from '../../modules/identity/api';

export type AuthContextValue = {
  checking: boolean;
  error: Error | null;
  retry: () => void;
  needsSetup: boolean;
  user: Me | null;
  /** Вид другой роли, который включил администратор; null — свой вид. */
  viewRole: Role | null;
  setViewRole: (role: Role | null) => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

/** Текущий пользователь внутри защищённых маршрутов. */
export function useMe(): Me {
  const { user } = useAuth();
  if (!user) throw new Error('useMe вне ProtectedRoute');
  return user;
}

/**
 * Роль, с которой показывается интерфейс: своя, а у администратора — выбранная для просмотра.
 * Влияет только на меню и кнопки; права на сервере остаются правами администратора.
 */
export function useRole(): Role {
  const { viewRole } = useAuth();
  const me = useMe();
  return effectiveRole(me.role, viewRole);
}

export const effectiveRole = (role: Role, viewRole: Role | null): Role =>
  role === 'admin' && viewRole ? viewRole : role;

/** Есть ли у текущего вида роль не ниже `min` (окончательно решает сервер). */
export function useCan(min: Role): boolean {
  return hasRole(useRole(), min);
}
