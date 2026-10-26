import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient, listClients, updateClient } from './api';

export const clientKeys = {
  all: ['clients'] as const,
  list: (q: string) => ['clients', 'list', q] as const,
};

export function useClients(q = '') {
  return useQuery({
    placeholderData: (previous) => previous,
    queryFn: () => listClients(q),
    queryKey: clientKeys.list(q),
  });
}

function useClientMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

export const useCreateClient = () => useClientMutation(createClient);
export const useUpdateClient = () => useClientMutation(updateClient);
