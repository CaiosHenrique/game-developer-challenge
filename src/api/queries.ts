import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query';
import { fetchPlayerMatches, fetchRanking } from './client.ts';
import { DEFAULT_PAGE_SIZE } from './contracts.ts';
import { ApiError } from './errors.ts';

/** Query keys: one cache entry per configuration (or player) and page. */
export const queryKeys = {
  ranking: ['ranking'] as const,
  rankingPage: (configKey: string, page: number) => ['ranking', configKey, page] as const,
  history: ['history'] as const,
  historyPage: (playerId: string, page: number) => ['history', playerId, page] as const,
};

/** Failed attempts are retried this many times, only for transient errors. */
export const MAX_RETRIES = 2;

export function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_RETRIES && error instanceof ApiError && error.transient;
}

/** 1 s, then 2 s (capped at 4 s). */
export function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 4000);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay,
        staleTime: 10_000,
        refetchOnWindowFocus: true,
      },
    },
  });
}

/**
 * Shared options of the paginated lists:
 * - while another page loads, the previous one stays on screen (marked as placeholder);
 * - showing a tab again always refreshes it in the background.
 */
const listOptions = {
  placeholderData: keepPreviousData,
  refetchOnMount: 'always',
} as const;

export function useRankingPage(configKey: string, page: number) {
  return useQuery({
    ...listOptions,
    queryKey: queryKeys.rankingPage(configKey, page),
    queryFn: ({ signal }) => fetchRanking(configKey, { page, pageSize: DEFAULT_PAGE_SIZE }, signal),
  });
}

export function useHistoryPage(playerId: string, page: number) {
  return useQuery({
    ...listOptions,
    queryKey: queryKeys.historyPage(playerId, page),
    queryFn: ({ signal }) =>
      fetchPlayerMatches(playerId, { page, pageSize: DEFAULT_PAGE_SIZE }, signal),
  });
}
