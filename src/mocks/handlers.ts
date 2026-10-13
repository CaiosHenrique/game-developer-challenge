import { delay, http, HttpResponse } from 'msw';
import type { z } from 'zod';
import {
  matchPageSchema,
  pageQuerySchema,
  rankingPageSchema,
  rankingQuerySchema,
  type ApiErrorBody,
} from '../api/contracts.ts';
import type { MockDb } from './db.ts';

/** Fixed, small latency: loading states are visible and timing stays reproducible. */
export const MOCK_LATENCY_MS = 150;

function errorResponse(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } } satisfies ApiErrorBody, { status });
}

function badRequest(error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue?.path.join('.') || 'query';
  return errorResponse(400, 'invalid_request', `Invalid ${field}: ${issue?.message ?? 'error'}`);
}

function searchParams(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}

/**
 * The ranking and match-history API. Requests and responses are checked against the same
 * contracts the client uses.
 */
export function createHandlers(db: MockDb) {
  return [
    http.get('/api/health', () => HttpResponse.json({ status: 'ok', mocked: true })),

    http.get('/api/ranking', async ({ request }) => {
      const query = rankingQuerySchema.safeParse(searchParams(request));
      if (!query.success) return badRequest(query.error);
      await delay(MOCK_LATENCY_MS);
      const { configKey, page, pageSize } = query.data;
      return HttpResponse.json(rankingPageSchema.parse(db.ranking(configKey, page, pageSize)));
    }),

    http.get('/api/players/:playerId/matches', async ({ request, params }) => {
      const query = pageQuerySchema.safeParse(searchParams(request));
      if (!query.success) return badRequest(query.error);
      await delay(MOCK_LATENCY_MS);
      const { page, pageSize } = query.data;
      const matches = db.playerMatches(String(params.playerId), page, pageSize);
      return HttpResponse.json(matchPageSchema.parse(matches));
    }),

    // Anything else under /api is not part of the API (instead of reaching the web server).
    http.all('/api/*', () => errorResponse(404, 'not_found', 'Unknown API endpoint.')),
  ];
}
