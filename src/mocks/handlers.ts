import { delay, http, HttpResponse } from 'msw';
import type { z } from 'zod';
import {
  matchPageSchema,
  matchRecordSchema,
  pageQuerySchema,
  rankingPageSchema,
  rankingQuerySchema,
  type ApiErrorBody,
  type MatchRecord,
  type Page,
} from '../api/contracts.ts';
import { Rng } from '../game/sim/rng.ts';
import { playerNameFor } from '../storage/localStore.ts';
import type { MockDb } from './db.ts';
import { manyPagesHistory, manyPagesRanking } from './fixtures.ts';
import { decide, type RequestKind, type ScenarioDecision, type ScenarioId } from './scenarios.ts';

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

/** The answer of a scenario that does not answer normally, or null when it does. */
async function failure(decision: ScenarioDecision): Promise<Response | null> {
  if (decision.kind === 'respond') return null;
  await delay(decision.delayMs);
  if (decision.kind === 'network-error') return HttpResponse.error();
  if (decision.kind === 'error') {
    return errorResponse(decision.status, decision.code, decision.message);
  }
  return null; // no-answer: the caller answers after the delay, long after the client gave up
}

export type ScenarioSource = {
  /** The scenario in force for the next request. */
  current: () => ScenarioId;
  /** Seed of the scenario latencies (same seed and requests: same delays). */
  seed: number;
};

/**
 * The ranking and match-history API. Requests and responses are checked against the same
 * contracts the client uses; the network scenario decides how (and whether) each request is
 * answered. Scenarios never change the stored data: lists are filtered or extended only in
 * the answer, and a match is only stored by a registration that reaches the database.
 */
export function createHandlers(db: MockDb, scenarios: ScenarioSource) {
  const rng = new Rng(scenarios.seed);
  let requestIndex = 0;
  /** Matches sent at least once in this page load (for "timeout after registering"). */
  const sent = new Set<string>();

  const decideFor = (kind: RequestKind, matchId?: string) => {
    const firstSend = matchId !== undefined && !sent.has(matchId);
    if (matchId !== undefined) sent.add(matchId);
    return decide(scenarios.current(), kind, { requestIndex: requestIndex++, rng, firstSend });
  };

  /** A list answer after the scenario's delay: as stored, empty, or with extra matches. */
  async function listAnswer<Item>(
    decision: ScenarioDecision,
    answer: (data: 'stored' | 'empty' | 'many-pages') => Page<Item>,
    schema: z.ZodType<Page<Item>>,
  ) {
    const failed = await failure(decision);
    if (failed) return failed;
    const data = decision.kind === 'respond' ? decision.data : 'stored';
    if (decision.kind === 'respond') await delay(decision.delayMs);
    return HttpResponse.json(schema.parse(answer(data)));
  }

  return [
    http.get('/api/health', () => HttpResponse.json({ status: 'ok', mocked: true })),

    http.get('/api/ranking', async ({ request }) => {
      const query = rankingQuerySchema.safeParse(searchParams(request));
      if (!query.success) return badRequest(query.error);
      const { configKey, page, pageSize } = query.data;
      return listAnswer(
        decideFor('ranking'),
        (data) =>
          data === 'empty'
            ? emptyPage(page, pageSize)
            : db.ranking(
                configKey,
                page,
                pageSize,
                data === 'many-pages' ? manyPagesRanking(configKey) : [],
              ),
        rankingPageSchema,
      );
    }),

    http.get('/api/players/:playerId/matches', async ({ request, params }) => {
      const query = pageQuerySchema.safeParse(searchParams(request));
      if (!query.success) return badRequest(query.error);
      const { page, pageSize } = query.data;
      const playerId = String(params.playerId);
      return listAnswer(
        decideFor('history'),
        (data) =>
          data === 'empty'
            ? emptyPage(page, pageSize)
            : db.playerMatches(
                playerId,
                page,
                pageSize,
                data === 'many-pages' ? manyPagesHistory(playerId, playerNameFor(playerId)) : [],
              ),
        matchPageSchema,
      );
    }),

    // Registers a completed match. Idempotent: sending the same record again returns the
    // stored one (200), never a second entry; another record under the same id is a conflict.
    http.put('/api/matches/:matchId', async ({ request, params }) => {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse(400, 'invalid_request', 'The body is not valid JSON.');
      }
      const record = matchRecordSchema.safeParse(body);
      if (!record.success) return badRequest(record.error);
      if (record.data.matchId !== params.matchId) {
        return errorResponse(400, 'match_id_mismatch', 'The match id does not match the URL.');
      }
      const decision = decideFor('submit', record.data.matchId);
      if (decision.kind === 'no-answer') {
        // Stored now (when the scenario says so), answered after the client gave up.
        const stored = decision.commitFirst ? register(record.data) : null;
        await delay(decision.delayMs);
        return stored ?? errorResponse(504, 'timeout', 'No answer in time (simulated).');
      }
      const failed = await failure(decision);
      if (failed) return failed;
      await delay(decision.delayMs);
      return register(record.data);
    }),

    // Anything else under /api is not part of the API (instead of reaching the web server).
    http.all('/api/*', () => errorResponse(404, 'not_found', 'Unknown API endpoint.')),
  ];

  /** Stores the match (idempotently) and builds the answer. */
  function register(record: MatchRecord) {
    const result = db.upsert(record);
    if (result.outcome === 'conflict') {
      return errorResponse(409, 'conflict', 'Another record already uses this match id.');
    }
    return HttpResponse.json(matchRecordSchema.parse(result.record), {
      status: result.outcome === 'created' ? 201 : 200,
    });
  }
}

/** A valid page with nothing on it. */
function emptyPage(page: number, pageSize: number): Page<never> {
  return { items: [], page, pageSize, totalItems: 0, totalPages: 0 };
}
