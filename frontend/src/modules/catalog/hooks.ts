import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDeviceModel,
  type DeviceModelListParams,
  listDeviceModels,
  listManufacturers,
  setDeviceModelArchived,
  updateDeviceModel,
} from './api';

export const catalogKeys = {
  all: ['devices'] as const,
  list: (params: DeviceModelListParams) => ['devices', 'list', params] as const,
  manufacturers: ['devices', 'manufacturers'] as const,
};

export function useDeviceModels(params: DeviceModelListParams) {
  return useQuery({
    placeholderData: (previous) => previous,
    queryFn: () => listDeviceModels(params),
    queryKey: catalogKeys.list(params),
  });
}

export const useManufacturers = () =>
  useQuery({ queryKey: catalogKeys.manufacturers, queryFn: listManufacturers });

function useCatalogMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    },
  });
}

export const useCreateDeviceModel = () => useCatalogMutation(createDeviceModel);
export const useUpdateDeviceModel = () => useCatalogMutation(updateDeviceModel);
export const useSetDeviceModelArchived = () => useCatalogMutation(setDeviceModelArchived);
