import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSettings, updateSettings } from './api';

export const settingsKeys = { all: ['settings'] as const };

export const useSettings = () =>
  useQuery({ queryKey: settingsKeys.all, queryFn: getSettings, staleTime: 5 * 60_000 });

/** Текущий разделитель адреса; пока настройки грузятся — «X» по умолчанию. */
export const useAddressSeparator = () => useSettings().data?.address_separator ?? 'X';

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSettings,
    onSuccess(settings) {
      queryClient.setQueryData(settingsKeys.all, settings);
      // Адреса в ответах сервера собираются с новым разделителем — обновляем всё, где они есть.
      for (const key of [['map'], ['locations'], ['deliveries'], ['audit']]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
