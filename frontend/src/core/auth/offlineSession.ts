import { isNetworkError } from '../api/client';
import { getSession, meSchema, type Me, type Session } from '../../modules/identity/api';

/**
 * Последний вошедший пользователь запоминается на устройстве: без связи ТСД откроет приложение
 * и сможет копить сканы в очереди. Права всё равно проверяет сервер при отправке.
 */
const LAST_USER_KEY = 'skladno.lastUser';

export function rememberUser(user: Me | null) {
  try {
    if (user) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // хранилище недоступно — офлайн-запуск просто не сработает
  }
}

export function cachedUser(): Me | null {
  try {
    const parsed = meSchema.safeParse(JSON.parse(localStorage.getItem(LAST_USER_KEY) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Сессия с сервера; без связи — последний пользователь этого устройства. */
export async function loadSession(): Promise<Session> {
  try {
    const session = await getSession();
    rememberUser(session.user);
    return session;
  } catch (error) {
    const user = cachedUser();
    if (isNetworkError(error) && user) return { needs_setup: false, user };
    throw error;
  }
}
