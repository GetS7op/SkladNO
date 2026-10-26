import { useState } from 'react';
import { ErrorBanner, Field } from '../../../core/ui/ui';
import type { ProfileInput } from '../api';

/** Форма регистрации по SPEC: Фамилия, Имя, Отчество, Логин, Пароль, Почта, Telegram (необязательно). */
export function ProfileForm(props: {
  submitLabel: string;
  pending: boolean;
  error: Error | null;
  onSubmit: (input: ProfileInput) => void;
}) {
  const [f, setF] = useState({
    last_name: '',
    first_name: '',
    middle_name: '',
    login: '',
    password: '',
    repeat: '',
    email: '',
    telegram: '',
  });
  const set = (key: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((v) => ({ ...v, [key]: e.target.value }));
  const mismatch = f.repeat.length > 0 && f.repeat !== f.password;

  return (
    <form
      className="auth-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (mismatch) return;
        props.onSubmit({
          login: f.login,
          last_name: f.last_name,
          first_name: f.first_name,
          middle_name: f.middle_name,
          email: f.email,
          telegram: f.telegram || null,
          password: f.password,
        });
      }}
    >
      <ErrorBanner error={props.error} />
      <div className="grid-3">
        <Field label="Фамилия" required>
          <input
            value={f.last_name}
            onChange={set('last_name')}
            required
            autoFocus
            autoComplete="family-name"
          />
        </Field>
        <Field label="Имя" required>
          <input value={f.first_name} onChange={set('first_name')} required autoComplete="given-name" />
        </Field>
        <Field label="Отчество" required>
          <input
            value={f.middle_name}
            onChange={set('middle_name')}
            required
            autoComplete="additional-name"
          />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Логин" required hint="Латиница, цифры, _ . -">
          <input value={f.login} onChange={set('login')} required autoComplete="username" />
        </Field>
        <Field label="Почта" required>
          <input type="email" value={f.email} onChange={set('email')} required autoComplete="email" />
        </Field>
        <Field label="Пароль" required hint="Не короче 8 символов">
          <input
            type="password"
            value={f.password}
            onChange={set('password')}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Пароль ещё раз" required error={mismatch ? 'Пароли не совпадают' : undefined}>
          <input
            type="password"
            value={f.repeat}
            onChange={set('repeat')}
            required
            autoComplete="new-password"
          />
        </Field>
        <Field label="Telegram" hint="Необязательно, например @ivanov">
          <input value={f.telegram} onChange={set('telegram')} />
        </Field>
      </div>
      <button type="submit" className="btn primary wide" disabled={props.pending || mismatch}>
        {props.submitLabel}
      </button>
    </form>
  );
}
