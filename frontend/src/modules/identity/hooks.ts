import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rememberUser } from '../../core/auth/offlineSession';
import {
  changePassword,
  createInvite,
  getInvite,
  listInvites,
  listUsers,
  login,
  logout,
  type Me,
  register,
  resetPassword,
  revokeInvite,
  type Session,
  setup,
  updateUser,
} from './api';

export const identityKeys = {
  session: ['auth', 'session'] as const,
  invite: (token: string) => ['auth', 'invite', token] as const,
  users: ['identity', 'users'] as const,
  invites: ['identity', 'invites'] as const,
};

/** Смена пользователя: данные прошлого пользователя выбрасываются, сессия подменяется сразу. */
export function switchUser(queryClient: QueryClient, user: Me | null) {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
  queryClient.setQueryData<Session>(identityKeys.session, { needs_setup: false, user });
  rememberUser(user);
}

function useSignInMutation<TInput>(mutationFn: (input: TInput) => Promise<Me>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess(user) {
      switchUser(queryClient, user);
    },
  });
}

export const useLogin = () => useSignInMutation(login);
export const useSetup = () => useSignInMutation(setup);
export const useRegister = () => useSignInMutation(register);

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled() {
      switchUser(queryClient, null);
    },
  });
}

export const useChangePassword = () => useMutation({ mutationFn: changePassword });

export function useInvite(token: string) {
  return useQuery({ queryKey: identityKeys.invite(token), queryFn: () => getInvite(token), retry: false });
}

export const useUsers = () => useQuery({ queryKey: identityKeys.users, queryFn: listUsers });

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateUser,
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: identityKeys.users });
      void queryClient.invalidateQueries({ queryKey: identityKeys.session });
    },
  });
}

export const useResetPassword = () => useMutation({ mutationFn: resetPassword });

export const useInvites = () => useQuery({ queryKey: identityKeys.invites, queryFn: listInvites });

export function useCreateInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createInvite,
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: identityKeys.invites });
    },
  });
}

export function useRevokeInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeInvite,
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: identityKeys.invites });
    },
  });
}
