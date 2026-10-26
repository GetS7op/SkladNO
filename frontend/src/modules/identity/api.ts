import { z } from 'zod';
import { apiGet, apiPost, apiPostEmpty, apiPut } from '../../core/api/client';
import { roleSchema } from '../../core/domain';

export const meSchema = z.object({
  id: z.string(),
  login: z.string(),
  last_name: z.string(),
  first_name: z.string(),
  middle_name: z.string(),
  email: z.string(),
  telegram: z.string().nullable(),
  role: roleSchema,
});
export type Me = z.infer<typeof meSchema>;

export const sessionSchema = z.object({
  needs_setup: z.boolean(),
  user: meSchema.nullable(),
});
export type Session = z.infer<typeof sessionSchema>;

const userSchema = meSchema.extend({
  active: z.boolean(),
  created_at: z.string(),
  last_login_at: z.string().nullable(),
});
export type User = z.infer<typeof userSchema>;

const inviteSchema = z.object({
  id: z.string(),
  role: roleSchema,
  note: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  created_by_login: z.string(),
  used_at: z.string().nullable(),
  used_by_login: z.string().nullable(),
  revoked_at: z.string().nullable(),
  status: z.enum(['active', 'used', 'expired', 'revoked']),
});
export type Invite = z.infer<typeof inviteSchema>;

const inviteInfoSchema = z.object({ role: roleSchema, expires_at: z.string().nullable() });

/** Форма регистрации (SPEC): Фамилия, Имя, Отчество, Логин, Пароль, Почта, Telegram (необязательно). */
export type ProfileInput = {
  login: string;
  last_name: string;
  first_name: string;
  middle_name: string;
  email: string;
  telegram: string | null;
  password: string;
};

export const fullName = (u: Pick<Me, 'last_name' | 'first_name' | 'middle_name'>) =>
  `${u.last_name} ${u.first_name} ${u.middle_name}`;

export const getSession = () => apiGet('/auth/status', sessionSchema);
export const setup = (input: ProfileInput) => apiPost('/auth/setup', input, meSchema);
export const login = (input: { login: string; password: string }) => apiPost('/auth/login', input, meSchema);
export const logout = () => apiPostEmpty('/auth/logout');
export const getInvite = (token: string) =>
  apiGet(`/auth/invites/${encodeURIComponent(token)}`, inviteInfoSchema);
export const register = ({ token, input }: { token: string; input: ProfileInput }) =>
  apiPost('/auth/register', { token, ...input }, meSchema);
export const changePassword = (input: { current: string; next: string }) =>
  apiPostEmpty('/auth/password', { current: input.current, new: input.next });

export const listUsers = () => apiGet('/users', z.array(userSchema));
export const updateUser = (input: { id: string; role: User['role']; active: boolean }) =>
  apiPut(`/users/${input.id}`, { role: input.role, active: input.active }, userSchema);
export const resetPassword = (id: string) =>
  apiPost(`/users/${id}/reset-password`, {}, z.object({ password: z.string() }));

export const listInvites = () => apiGet('/invites', z.array(inviteSchema));
export const createInvite = (input: { role: User['role']; days: number | null; note: string | null }) =>
  apiPost('/invites', input, z.object({ invite: inviteSchema, path: z.string() }));
export const revokeInvite = (id: string) => apiPostEmpty(`/invites/${id}/revoke`);
