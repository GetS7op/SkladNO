import { useSetup } from '../hooks';
import { AuthScreen } from './AuthScreen';
import { ProfileForm } from './ProfileForm';

/** Первый запуск: пока пользователей нет, форма создаёт администратора. */
export function SetupPage() {
  const submit = useSetup();
  return (
    <AuthScreen
      title="Первый запуск"
      subtitle="Пользователей ещё нет. Создайте учётную запись администратора — дальше сотрудники входят по приглашениям."
    >
      <ProfileForm
        submitLabel="Создать администратора"
        pending={submit.isPending}
        error={submit.error}
        onSubmit={(input) => submit.mutate(input)}
      />
    </AuthScreen>
  );
}
