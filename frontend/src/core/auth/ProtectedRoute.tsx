import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isNetworkError } from '../api/client';
import { hasRole, type Role } from '../domain';
import { ErrorBanner } from '../ui/ui';
import { AuthScreen } from '../../modules/identity/pages/AuthScreen';
import { useAuth } from './context';

/** Пускает только после входа; при первом запуске ведёт на создание администратора. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { checking, error, retry, needsSetup, user } = useAuth();
  const location = useLocation();

  if (checking) return <div className="auth-screen muted">Проверяем сессию…</div>;

  if (error) {
    return (
      <AuthScreen title="SkladNO недоступен">
        {isNetworkError(error) ? (
          <p>
            Нет связи с сервером. Проверьте сеть и обновите страницу. Работать без связи можно на устройстве,
            где уже выполнялся вход.
          </p>
        ) : (
          <ErrorBanner error={error} />
        )}
        <button type="button" className="btn primary wide" onClick={retry}>
          Повторить
        </button>
      </AuthScreen>
    );
  }

  if (!user) return <Navigate to={needsSetup ? '/setup' : '/login'} replace state={{ from: location }} />;
  return children;
}

/** Раздел только для роли не ниже `min` (например, «Пользователи» — администратору). */
export function RoleRoute({ min, children }: { min: Role; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !hasRole(user.role, min)) return <Navigate to="/" replace />;
  return children;
}
