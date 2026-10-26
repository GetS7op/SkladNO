import { useParams } from 'react-router-dom';
import { roleLabel } from '../../../core/domain';
import { formatDate } from '../../../core/ui/format';
import { ErrorBanner } from '../../../core/ui/ui';
import { useInvite, useRegister } from '../hooks';
import { AuthScreen } from './AuthScreen';
import { ProfileForm } from './ProfileForm';

/** Регистрация по ссылке-приглашению: роль и срок задал администратор. */
export function RegisterPage() {
  const { token = '' } = useParams();
  const invite = useInvite(token);
  const submit = useRegister();

  if (invite.isPending) return <div className="auth-screen muted">Проверяем приглашение…</div>;
  if (invite.error) {
    return (
      <AuthScreen title="Приглашение не действует">
        <ErrorBanner error={invite.error} />
        <a href="/login" className="btn wide">
          Ко входу
        </a>
      </AuthScreen>
    );
  }
  const expires = invite.data.expires_at
    ? `. Приглашение действует до ${formatDate(invite.data.expires_at)}`
    : '';
  return (
    <AuthScreen
      title="Регистрация"
      subtitle={`Вас пригласили с ролью «${roleLabel(invite.data.role)}»${expires}.`}
    >
      <ProfileForm
        submitLabel="Зарегистрироваться"
        pending={submit.isPending}
        error={submit.error}
        onSubmit={(input) => submit.mutate({ token, input })}
      />
    </AuthScreen>
  );
}
