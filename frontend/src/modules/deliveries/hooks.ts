import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  advanceDelivery,
  createDelivery,
  type DeliveryListParams,
  getDelivery,
  getDevice,
  type InventoryParams,
  getInventoryStats,
  listInventory,
  updateDevice,
  importDeviceData,
  listDeliveries,
  listDeliveryFiles,
  listDeliveryGroups,
  uploadDeliveryFile,
} from './api';

export const deliveryKeys = {
  all: ['deliveries'] as const,
  list: (params: DeliveryListParams) => ['deliveries', 'list', params] as const,
  detail: (id: string) => ['deliveries', 'detail', id] as const,
  files: (id: string) => ['deliveries', 'files', id] as const,
  groups: ['deliveries', 'groups'] as const,
  inventory: (params: InventoryParams) => ['deliveries', 'inventory', params] as const,
  inventoryStats: (destination: string) => ['deliveries', 'inventory-stats', destination] as const,
  device: (id: string) => ['deliveries', 'device', id] as const,
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

/** Загрузка данных устройств из шаблона; после настоящей загрузки обновляет поставку и журнал. */
export function useImportDeviceData(id: string, dryRun: boolean) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => importDeviceData({ id, file, dryRun }),
    onSuccess() {
      if (dryRun) return;
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
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

/** Реестр INDEX: все найденные устройства разом (как в mf-old). */
export function useInventory(params: InventoryParams) {
  return useQuery({
    queryKey: deliveryKeys.inventory(params),
    queryFn: () => listInventory(params),
    placeholderData: (previous) => previous,
  });
}

export const useInventoryStats = (destination: string) =>
  useQuery({
    queryKey: deliveryKeys.inventoryStats(destination),
    queryFn: () => getInventoryStats(destination),
  });

export const useDevice = (id: string) =>
  useQuery({ queryKey: deliveryKeys.device(id), queryFn: () => getDevice(id) });

export function useUpdateDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateDevice,
    onSuccess(card) {
      queryClient.setQueryData(deliveryKeys.device(card.id), card);
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}
