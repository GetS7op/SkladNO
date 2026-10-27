import { Eye, KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useAuth, useMe } from '../auth/context';
import { ROLES, type Role, roleLabel } from '../domain';
import { ErrorBanner, Field, Modal } from '../ui/ui';
import { useChangePassword, useLogout } from '../../modules/identity/hooks';

/** Карточка пользователя внизу меню: роль, вид роли (администратор), смена пароля, выход. */
export function UserMenu() {
  const me = useMe();
  const { viewRole, setViewRole } = useAuth();
  const [changing, setChanging] = useState(false);
  const logout = useLogout();

  return (
    <div className="user-card">
      <div>
        <b>
          {me.last_name} {me.first_name.charAt(0)}.{me.middle_name.charAt(0)}.
        </b>
        <span>
          {roleLabel(me.role)} · {me.login}
        </span>
      </div>
      {me.role === 'admin' && (
        <label className="view-role" title="Показать интерфейс так, как его видит выбранная роль">
          <Eye size={16} />
          <select
            value={viewRole ?? 'admin'}
            onChange={(e) => {
              const role = e.target.value as Role;
              setViewRole(role === 'admin' ? null : role);
            }}
            aria-label="Вид интерфейса для роли"
          >
            {[...ROLES].reverse().map((r) => (
              <option key={r.value} value={r.value}>
                Вид: {r.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="user-actions">
        <button type="button" className="nav-item" onClick={() => setChanging(true)}>
          <KeyRound size={16} /> Сменить пароль
        </button>
        <button type="button" className="nav-item" onClick={() => logout.mutate()}>
          <LogOut size={16} /> Выйти
        </button>
      </div>
      {changing && <PasswordForm onClose={() => setChanging(false)} />}
    </div>
  );
}

function PasswordForm({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const change = useChangePassword();
  const mismatch = repeat.length > 0 && repeat !== next;

  return (
    <Modal
      title="Смена пароля"
      onClose={onClose}
      onSubmit={() => (change.isSuccess ? onClose() : !mismatch && change.mutate({ current, next }))}
      footer={
        <>
          <span className="spacer" />
          {change.isSuccess ? (
            <button type="submit" className="btn primary">
              Готово
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onClose}>
                Отмена
              </button>
              <button type="submit" className="btn primary" disabled={change.isPending || mismatch}>
                Сменить
              </button>
            </>
          )}
        </>
      }
    >
      <ErrorBanner error={change.error} />
      {change.isSuccess ? (
        <div className="banner ok">Пароль изменён. Остальные ваши сессии на других устройствах закрыты.</div>
      ) : (
        <>
          <Field label="Текущий пароль" required>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoFocus
              autoComplete="current-password"
            />
          </Field>
          <Field label="Новый пароль" required hint="Не короче 8 символов">
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Новый пароль ещё раз" required error={mismatch ? 'Пароли не совпадают' : undefined}>
            <input
              type="password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
              autoComplete="new-password"
            />
          </Field>
        </>
      )}
    </Modal>
  );
}
