import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import { type Invite, type Role, type User, api } from '../api';
import { ROLES, fullName, roleLabel, useMe } from '../auth';
import { ErrorBanner, Field, Modal, Segmented } from '../components/ui';
import { formatDate, formatDateTime } from '../format';

const INVITE_STATUS: Record<Invite['status'], string> = {
  active: 'Действует',
  used: 'Использовано',
  expired: 'Истекло',
  revoked: 'Отозвано',
};

/** Пользователи и приглашения (только администратор). */
export function UsersPage() {
  const [tab, setTab] = useState<'users' | 'invites'>('users');
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Пользователи</h1>
          <p className="muted">Доступ выдаётся ссылкой-приглашением с ролью и сроком действия</p>
        </div>
      </header>
      <div className="registry-toolbar">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'users', label: 'Пользователи' },
            { value: 'invites', label: 'Приглашения' },
          ]}
        />
      </div>
      {tab === 'users' ? <UsersTable /> : <InvitesTable />}
    </div>
  );
}

function UsersTable() {
  const users = useQuery({ queryKey: ['users'], queryFn: api.users.list });
  const [editing, setEditing] = useState<User | null>(null);
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>ФИО</th>
              <th>Логин</th>
              <th>Роль</th>
              <th>Почта</th>
              <th>Telegram</th>
              <th>Последний вход</th>
              <th>Состояние</th>
            </tr>
          </thead>
          <tbody>
            {users.error && (
              <tr>
                <td colSpan={7} className="table-note error">
                  {users.error.message}
                </td>
              </tr>
            )}
            {users.data?.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => setEditing(u)}>
                <td>
                  <b>{fullName(u)}</b>
                </td>
                <td className="mono">{u.login}</td>
                <td>{roleLabel(u.role)}</td>
                <td>{u.email}</td>
                <td>{u.telegram ?? '—'}</td>
                <td>{u.last_login_at ? formatDateTime(u.last_login_at) : '—'}</td>
                <td>
                  <span className={`badge ${u.active ? 'yes' : 'no'}`}>
                    {u.active ? 'Активен' : 'Отключён'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserForm user={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function UserForm({ user, onClose }: { user: User; onClose: () => void }) {
  const queryClient = useQueryClient();
  const me = useMe();
  const [role, setRole] = useState<Role>(user.role);
  const [active, setActive] = useState(user.active);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.users.update(user.id, role, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      onClose();
    },
  });
  const reset = useMutation({
    mutationFn: () => api.users.resetPassword(user.id),
    onSuccess: (r) => setTempPassword(r.password),
  });

  return (
    <Modal
      title={fullName(user)}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      footer={
        <>
          <button
            type="button"
            className="btn ghost"
            disabled={reset.isPending}
            onClick={() => {
              if (window.confirm(`Сбросить пароль ${user.login}? Все его сессии будут закрыты.`))
                reset.mutate();
            }}
          >
            <KeyRound size={16} /> Сбросить пароль
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={save.isPending}>
            Сохранить
          </button>
        </>
      }
    >
      <ErrorBanner error={save.error ?? reset.error} />
      {tempPassword && (
        <div className="banner ok">
          Временный пароль для <b>{user.login}</b>: <CopyValue value={tempPassword} />
          <br />
          Показывается один раз — передайте его сотруднику и попросите сменить после входа.
        </div>
      )}
      <dl className="props compact">
        <dt>Логин</dt>
        <dd className="mono">{user.login}</dd>
        <dt>Почта</dt>
        <dd>{user.email}</dd>
        <dt>Telegram</dt>
        <dd>{user.telegram ?? '—'}</dd>
        <dt>Зарегистрирован</dt>
        <dd>{formatDate(user.created_at)}</dd>
      </dl>
      <Field label="Роль">
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label} — {r.hint}
            </option>
          ))}
        </select>
      </Field>
      <label className="check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Учётная запись активна
      </label>
      {user.id === me.id && <p className="muted small">Это ваша учётная запись.</p>}
    </Modal>
  );
}

function InvitesTable() {
  const queryClient = useQueryClient();
  const invites = useQuery({ queryKey: ['invites'], queryFn: api.invites.list });
  const [creating, setCreating] = useState(false);
  const revoke = useMutation({
    mutationFn: api.invites.revoke,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });

  return (
    <>
      <div className="registry-toolbar">
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Новое приглашение
        </button>
      </div>
      <ErrorBanner error={revoke.error} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Создано</th>
              <th>Роль</th>
              <th>Заметка</th>
              <th>Действует до</th>
              <th>Состояние</th>
              <th>Кто создал</th>
              <th>Кто зарегистрировался</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invites.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="table-note">
                  Приглашений пока нет
                </td>
              </tr>
            )}
            {invites.data?.map((i) => (
              <tr key={i.id}>
                <td>{formatDateTime(i.created_at)}</td>
                <td>{roleLabel(i.role)}</td>
                <td>{i.note ?? '—'}</td>
                <td>{i.expires_at ? formatDateTime(i.expires_at) : 'бессрочно'}</td>
                <td>
                  <span className={`badge ${i.status === 'active' ? 'yes' : ''}`}>
                    {INVITE_STATUS[i.status]}
                  </span>
                </td>
                <td className="mono">{i.created_by_login}</td>
                <td className="mono">{i.used_by_login ?? '—'}</td>
                <td>
                  {i.status === 'active' && (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => window.confirm('Отозвать приглашение?') && revoke.mutate(i.id)}
                    >
                      Отозвать
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && <InviteForm onClose={() => setCreating(false)} />}
    </>
  );
}

const DURATIONS = [
  { value: '1', label: '1 день' },
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: 'forever', label: 'Бессрочно' },
];

function InviteForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Role>('operator');
  const [duration, setDuration] = useState('7');
  const [note, setNote] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.invites.create(role, duration === 'forever' ? null : Number(duration), note || null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });
  const link = create.data ? `${window.location.origin}${create.data.path}` : null;

  return (
    <Modal
      title="Новое приглашение"
      onClose={onClose}
      onSubmit={() => (link ? onClose() : create.mutate())}
      footer={
        <>
          <span className="spacer" />
          {link ? (
            <button type="submit" className="btn primary">
              Готово
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onClose}>
                Отмена
              </button>
              <button type="submit" className="btn primary" disabled={create.isPending}>
                Создать ссылку
              </button>
            </>
          )}
        </>
      }
    >
      <ErrorBanner error={create.error} />
      {link ? (
        <div className="banner ok">
          Ссылка для регистрации ({roleLabel(role)}):
          <CopyValue value={link} />
          Ссылка показывается один раз и работает для одной регистрации. Отправьте её сотруднику.
        </div>
      ) : (
        <>
          <Field label="Роль" hint={ROLES.find((r) => r.value === role)?.hint}>
            <Segmented value={role} onChange={setRole} options={ROLES} />
          </Field>
          <Field label="Срок действия">
            <Segmented value={duration} onChange={setDuration} options={DURATIONS} />
          </Field>
          <Field label="Заметка" hint="Для кого приглашение, например «Смена А, Иванов»">
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </>
      )}
    </Modal>
  );
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy-value">
      <code>{value}</code>
      <button
        type="button"
        className="icon-btn"
        aria-label="Скопировать"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            window.prompt('Скопируйте вручную:', value);
          }
        }}
      >
        <Copy size={16} />
      </button>
      {copied && <span className="small">скопировано</span>}
    </span>
  );
}
