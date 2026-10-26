import { useMutation, useQueryClient } from '@tanstack/react-query';
import { catalogKeys } from '../catalog/hooks';
import { clientKeys } from '../clients/hooks';
import { importRegistry, type ImportRegistry } from './api';

const REGISTRY_KEYS: Record<ImportRegistry, readonly string[]> = {
  devices: catalogKeys.all,
  clients: clientKeys.all,
};

/** Загрузка справочника; после настоящего импорта (не пробного) обновляет его реестр. */
export function useImportRegistry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importRegistry,
    onSuccess(report, { registry }) {
      if (!report.dry_run) void queryClient.invalidateQueries({ queryKey: REGISTRY_KEYS[registry] });
    },
  });
}
