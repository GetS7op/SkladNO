import { useState } from 'react';
import { ErrorBanner, Field } from '../../../core/ui/ui';
import { useLogin } from '../hooks';
import { AuthScreen } from './AuthScreen';

/** После входа PublicOnlyRoute вернёт на страницу, с которой отправили на вход. */
export function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const submit = useLogin();

  return (
    <AuthScreen title="Вход" subtitle="Учёт и размещение оборудования майнинг-фермы">
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate({ login, password });
        }}
      >
        <ErrorBanner error={submit.error} />
        <Field label="Логин">
          <input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </Field>
        <Field label="Пароль">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <button type="submit" className="btn primary wide" disabled={submit.isPending}>
          Войти
        </button>
        <p className="muted small">Нет учётной записи? Попросите у администратора ссылку-приглашение.</p>
      </form>
    </AuthScreen>
  );
}
