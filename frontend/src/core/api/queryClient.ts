import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Ошибки 4xx повторять бессмысленно; сбой сети или сервера — один повтор.
      retry(failureCount, error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 1;
      },
      staleTime: 10_000,
    },
    mutations: {
      retry: false,
    },
  },
});
