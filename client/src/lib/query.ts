import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/http';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Les URLs de médias signées expirent en 5 min : on garde des données fraîches (< 4 min) sans refetch agressif.
      gcTime: 4 * 60_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});
