import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  advanceDelivery,
  createDelivery,
  type DeliveryListParams,
  getDelivery,
  listDeliveries,
  listDeliveryFiles,
  listDeliveryGroups,
  listIndexRanges,
  uploadDeliveryFile,
} from './api';

export const deliveryKeys = {
  all: ['deliveries'] as const,
  list: (params: DeliveryListParams) => ['deliveries', 'list', params] as const,
  detail: (id: string) => ['deliveries', 'detail', id] as const,
  files: (id: string) => ['deliveries', 'files', id] as const,
  groups: ['deliveries', 'groups'] as const,
  indexRanges: ['deliveries', 'index-ranges'] as const,
};

/** После действий с поставкой меняются карта, склады, журнал — их тоже обновляем. */
const RELATED = [['map'], ['locations'], ['audit'], ['clients']] as const;

export function useDeliveries(params: DeliveryListParams) {
  return useQuery({
    placeholderData: (previous) => previous,
    queryFn: () => listDeliveries(params),
    queryKey: deliveryKeys.list(params),
  });
}

export function useDelivery(id: string) {
  return useQuery({ queryFn: () => getDelivery(id), queryKey: deliveryKeys.detail(id) });
}

export const useDeliveryGroups = () =>
  useQuery({ queryKey: deliveryKeys.groups, queryFn: listDeliveryGroups });

export const useIndexRanges = () =>
  useQuery({ queryKey: deliveryKeys.indexRanges, queryFn: listIndexRanges });

export function useCreateDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createDelivery,
    onSuccess(delivery) {
      queryClient.setQueryData(deliveryKeys.detail(delivery.id), delivery);
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      for (const key of RELATED) void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useAdvanceDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: advanceDelivery,
    onSuccess(delivery) {
      queryClient.setQueryData(deliveryKeys.detail(delivery.id), delivery);
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
    },
    onError(_, { id }) {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(id) });
    },
  });
}

export function useDeliveryFiles(id: string) {
  return useQuery({ queryFn: () => listDeliveryFiles(id), queryKey: deliveryKeys.files(id) });
}

export function useUploadDeliveryFiles(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) await uploadDeliveryFile({ id, file });
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.files(id) });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}
