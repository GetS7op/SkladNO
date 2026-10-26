import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid } from 'lucide-react';
import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { type Me, type ProfileInput, type Role, UNAUTHORIZED_EVENT, api } from './api';
import { ErrorBanner, Field } from './components/ui';
import { formatDate } from './format';
import { isNetworkError } from './scanQueue';

export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'operator', label: 'СА', hint: 'Просмотр, создание поставок, приём сканированием' },
  { value: 'senior', label: 'Старший СА', hint: '+ справочники, подтверждение и закрытие поставок' },
  { value: 'admin', label: 'Администратор', hint: '+ пользователи и приглашения' },
];
const RANK: Record<Role, number> = { operator: 0, senior: 1, admin: 2 };

export const roleLabel = (role: Role) => ROLES.find((r) => r.value === role)?.label ?? role;
export const fullName = (u: Pick<Me, 'last_name' | 'first_name' | 'middle_name'>) =>
  `${u.last_name} ${u.first_name} ${u.middle_name}`;

const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe вне AuthGate');
  return me;
}

/** Есть ли у текущего пользователя роль не ниже `min`. */
export function useCan(min: Role): boolean {
  return RANK[useMe().role] >= RANK[min];
}

/** Пускает в приложение только после входа; при первом запуске — форма администратора. */
export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['auth'], queryFn: loadStatus, staleTime: Infinity });

  useEffect(() => {
    const onUnauthorized = () => queryClient.invalidateQueries({ queryKey: ['auth'] });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [queryClient]);

  if (status.isPending) return <div className="auth-screen muted">Загрузка…</div>;
  if (status.error)
    return (
      <AuthScreen title="SkladNO недоступен">
        {isNetworkError(status.error) ? (
          <p>
            Нет связи с сервером. Проверьте сеть и обновите страницу. Работать без связи можно на устройстве,
            где уже выполнялся вход.
          </p>
        ) : (
          <ErrorBanner error={status.error} />
        )}
        <button type="button" className="btn primary wide" onClick={() => status.refetch()}>
          Повторить
        </button>
      </AuthScreen>
    );

  const { needs_setup, user } = status.data;
  if (user) return <MeContext.Provider value={user}>{children}</MeContext.Provider>;
  return (
    <Routes>
      <Route path="/invite/:token" element={<RegisterPage />} />
      <Route path="*" element={needs_setup ? <SetupPage /> : <LoginPage />} />
    </Routes>
  );
}

function AuthScreen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">
            <LayoutGrid size={20} />
          </span>
          <strong>SkladNO</strong>
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

/** Смена пользователя: данные прошлого пользователя выбрасываются, состояние входа подменяется сразу. */
export function switchUser(queryClient: QueryClient, user: Me | null) {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
  queryClient.setQueryData(['auth'], { needs_setup: false, user });
  rememberUser(user);
}

// Последний вошедший пользователь запоминается на устройстве: без связи ТСД откроет приложение
// и сможет копить сканы в очереди. Права всё равно проверяет сервер при отправке.
const LAST_USER_KEY = 'skladno.lastUser';

function rememberUser(user: Me | null) {
  try {
    if (user) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // хранилище недоступно — офлайн-запуск просто не сработает
  }
}

async function loadStatus() {
  try {
    const status = await api.auth.status();
    rememberUser(status.user);
    return status;
  } catch (error) {
    const cached = (() => {
      try {
        return JSON.parse(localStorage.getItem(LAST_USER_KEY) ?? 'null') as Me | null;
      } catch {
        return null;
      }
    })();
    if (isNetworkError(error) && cached) return { needs_setup: false, user: cached };
    throw error;
  }
}

function useSignedIn() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (me: Me) => {
    switchUser(queryClient, me);
    navigate('/', { replace: true });
  };
}

function LoginPage() {
  const signedIn = useSignedIn();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const submit = useMutation({ mutationFn: () => api.auth.login(login, password), onSuccess: signedIn });
  return (
    <AuthScreen title="Вход" subtitle="Учёт и размещение оборудования майнинг-фермы">
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
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

function SetupPage() {
  const signedIn = useSignedIn();
  const submit = useMutation({ mutationFn: api.auth.setup, onSuccess: signedIn });
  return (
    <AuthScreen
      title="Первый запуск"
      subtitle="Пользователей ещё нет. Создайте учётную запись администратора — дальше сотрудники входят по приглашениям."
    >
      <ProfileForm
        submitLabel="Создать администратора"
        pending={submit.isPending}
        error={submit.error}
        onSubmit={submit.mutate}
      />
    </AuthScreen>
  );
}

function RegisterPage() {
  const { token = '' } = useParams();
  const signedIn = useSignedIn();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.auth.invite(token),
    retry: false,
  });
  const submit = useMutation({
    mutationFn: (input: ProfileInput) => api.auth.register(token, input),
    onSuccess: signedIn,
  });

  if (invite.isPending) return <div className="auth-screen muted">Проверяем приглашение…</div>;
  if (invite.error)
    return (
      <AuthScreen title="Приглашение не действует">
        <ErrorBanner error={invite.error} />
        <a href="/" className="btn wide">
          Ко входу
        </a>
      </AuthScreen>
    );
  return (
    <AuthScreen
      title="Регистрация"
      subtitle={`Вас пригласили с ролью «${roleLabel(invite.data.role)}»${invite.data.expires_at ? `. Приглашение действует до ${formatDate(invite.data.expires_at)}` : ''}.`}
    >
      <ProfileForm
        submitLabel="Зарегистрироваться"
        pending={submit.isPending}
        error={submit.error}
        onSubmit={submit.mutate}
      />
    </AuthScreen>
  );
}

/** Форма регистрации по SPEC: Фамилия, Имя, Отчество, Логин, Пароль, Почта, Telegram (необязательно). */
function ProfileForm(props: {
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
        const { repeat: _repeat, ...input } = f;
        props.onSubmit({ ...input, telegram: f.telegram || null });
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
