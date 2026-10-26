import { createContext, useContext } from 'react';
import { hasRole, type Role } from '../domain';
import type { Me } from '../../modules/identity/api';

export type AuthContextValue = {
  checking: boolean;
  error: Error | null;
  retry: () => void;
  needsSetup: boolean;
  user: Me | null;
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

/** Есть ли у текущего пользователя роль не ниже `min` (окончательно решает сервер). */
export function useCan(min: Role): boolean {
  return hasRole(useMe().role, min);
}
