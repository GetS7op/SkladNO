import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPool,
  createWorker,
  listPools,
  listWorkerGroups,
  listWorkers,
  setPoolArchived,
  setWorkerArchived,
  updatePool,
  updateWorker,
  type WhitelistParams,
} from './api';

export const whitelistKeys = {
  all: ['whitelists'] as const,
  pools: (params: WhitelistParams) => ['whitelists', 'pools', params] as const,
  workers: (params: WhitelistParams) => ['whitelists', 'workers', params] as const,
  groups: ['whitelists', 'worker-groups'] as const,
};

export function usePools(params: WhitelistParams) {
  return useQuery({
    placeholderData: (previous) => previous,
    queryFn: () => listPools(params),
    queryKey: whitelistKeys.pools(params),
  });
}

export function useWorkers(params: WhitelistParams) {
  return useQuery({
    placeholderData: (previous) => previous,
    queryFn: () => listWorkers(params),
    queryKey: whitelistKeys.workers(params),
  });
}

export const useWorkerGroups = () => useQuery({ queryKey: whitelistKeys.groups, queryFn: listWorkerGroups });

/** Пулы и воркеры связаны (счётчик воркеров у пула), поэтому обновляем оба списка. */
function useWhitelistMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: whitelistKeys.all });
    },
  });
}

export const useCreatePool = () => useWhitelistMutation(createPool);
export const useUpdatePool = () => useWhitelistMutation(updatePool);
export const useSetPoolArchived = () => useWhitelistMutation(setPoolArchived);
export const useCreateWorker = () => useWhitelistMutation(createWorker);
export const useUpdateWorker = () => useWhitelistMutation(updateWorker);
export const useSetWorkerArchived = () => useWhitelistMutation(setWorkerArchived);
