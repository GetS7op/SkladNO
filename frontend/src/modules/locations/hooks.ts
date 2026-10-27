import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContainer,
  createModule,
  createWarehouse,
  getMap,
  getShelf,
  listContainers,
  listModules,
  listWarehouses,
  type ModuleListParams,
  updateContainer,
  renameWarehouse,
  updateModule,
} from './api';

export const locationKeys = {
  all: ['locations'] as const,
  containers: (q: string) => ['locations', 'containers', q] as const,
  modules: (params: ModuleListParams) => ['locations', 'modules', params] as const,
  warehouses: ['locations', 'warehouses'] as const,
  map: (warehouse: string) => ['map', warehouse] as const,
  shelf: (code: string) => ['map', 'shelf', code] as const,
};

export function useContainers(q = '') {
  return useQuery({
    placeholderData: (previous) => previous,
    queryFn: () => listContainers(q),
    queryKey: locationKeys.containers(q),
  });
}

export function useModules(params: ModuleListParams) {
  return useQuery({
    placeholderData: (previous) => previous,
    queryFn: () => listModules(params),
    queryKey: locationKeys.modules(params),
  });
}

export const useWarehouses = () =>
  useQuery({ queryKey: locationKeys.warehouses, queryFn: listWarehouses, staleTime: 60_000 });

/** Склады для выбора: [{ value: код, label: имя }]. */
export function useWarehouseOptions() {
  const warehouses = useWarehouses();
  return (warehouses.data ?? []).map((w) => ({ value: w.code, label: w.name }));
}

/** Имя склада по коду; пока справочник грузится — код. */
export function useWarehouseName() {
  const warehouses = useWarehouses();
  return (code: string) => warehouses.data?.find((w) => w.code === code)?.name ?? code;
}

export const useMap = (warehouse: string) =>
  useQuery({ queryKey: locationKeys.map(warehouse), queryFn: () => getMap(warehouse) });

export const useShelf = (code: string) =>
  useQuery({ queryKey: locationKeys.shelf(code), queryFn: () => getShelf(code) });

/** Контейнеры, модули, карта и склады зависят друг от друга — обновляем всё размещение. */
function useLocationMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: locationKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['map'] });
    },
  });
}

export const useCreateContainer = () => useLocationMutation(createContainer);
export const useUpdateContainer = () => useLocationMutation(updateContainer);
export const useCreateModule = () => useLocationMutation(createModule);
export const useUpdateModule = () => useLocationMutation(updateModule);

/** Склад меняет подписи в поставках и реестрах — обновляем и их. */
function useWarehouseMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess() {
      for (const key of [locationKeys.all, ['map'], ['deliveries'], ['audit']]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export const useCreateWarehouse = () => useWarehouseMutation(createWarehouse);
export const useRenameWarehouse = () => useWarehouseMutation(renameWarehouse);

/** После размещения устройства меняются карта, склады, поставка и журнал. */
export function useRefreshAfterPlacement() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of [['map'], locationKeys.all, ['deliveries'], ['audit']]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
}
