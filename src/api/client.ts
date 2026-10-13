import type { z } from 'zod';
import {
  matchPageSchema,
  rankingPageSchema,
  type MatchRecord,
  type Page,
  type RankingEntry,
} from './contracts.ts';
import { ApiError, toApiError } from './errors.ts';
import { http } from './http.ts';

export type PageRequest = { page: number; pageSize: number };

/**
 * GETs a page and validates it against the contract. A page other than the one asked for
 * is rejected, so a response can only ever be shown as the page it was requested for.
 */
async function getPage<Item>(
  url: string,
  schema: z.ZodType<Page<Item>>,
  params: PageRequest & Record<string, string | number>,
  signal?: AbortSignal,
): Promise<Page<Item>> {
  let data: unknown;
  try {
    ({ data } = await http.get<unknown>(url, { params, signal }));
  } catch (error) {
    throw toApiError(error);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError('invalid-response', 'The server sent data in an unexpected format.');
  }
  if (parsed.data.page !== params.page) {
    throw new ApiError('invalid-response', 'The server sent a different page.');
  }
  return parsed.data;
}

/** Ranking of the matches played with one configuration. */
export function fetchRanking(
  configKey: string,
  request: PageRequest,
  signal?: AbortSignal,
): Promise<Page<RankingEntry>> {
  return getPage('/ranking', rankingPageSchema, { ...request, configKey }, signal);
}

/** Match history of one player, most recent first. */
export function fetchPlayerMatches(
  playerId: string,
  request: PageRequest,
  signal?: AbortSignal,
): Promise<Page<MatchRecord>> {
  return getPage(
    `/players/${encodeURIComponent(playerId)}/matches`,
    matchPageSchema,
    { ...request },
    signal,
  );
}
