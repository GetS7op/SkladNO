import type { ReactNode } from 'react';
import { type Location, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context';

/**
 * Вход, первый запуск и регистрация — только без сессии. Форма первого запуска доступна,
 * пока в системе нет пользователей; после этого — вход. После входа — обратно на страницу,
 * с которой ProtectedRoute отправил на вход.
 */
export function PublicOnlyRoute({ children, setup = false }: { children: ReactNode; setup?: boolean }) {
  const { checking, needsSetup, user } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: Location } | null)?.from;

  if (checking) return <div className="auth-screen muted">Проверяем сессию…</div>;
  if (user) return <Navigate to={from ? `${from.pathname}${from.search}` : '/'} replace />;
  if (setup && !needsSetup) return <Navigate to="/login" replace />;
  if (!setup && needsSetup) return <Navigate to="/setup" replace />;
  return children;
}
