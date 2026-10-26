import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { roleLabel, switchUser, useMe } from '../auth';
import { ErrorBanner, Field, Modal } from './ui';

/** Карточка пользователя внизу меню: роль, смена пароля, выход. */
export function UserMenu() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [changing, setChanging] = useState(false);
  const logout = useMutation({
    mutationFn: api.auth.logout,
    onSettled: () => switchUser(queryClient, null),
  });

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
  const change = useMutation({ mutationFn: () => api.auth.changePassword(current, next) });
  const mismatch = repeat.length > 0 && repeat !== next;

  return (
    <Modal
      title="Смена пароля"
      onClose={onClose}
      onSubmit={() => (change.isSuccess ? onClose() : !mismatch && change.mutate())}
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
