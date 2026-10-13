// HTTP client of the ranking and history API, run against a fake Axios adapter:
// `npm run test:unit`.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from 'axios';
import { fetchPlayerMatches, fetchRanking } from './client.ts';
import { matchRecordSchema, type MatchRecord, type Page, type RankingEntry } from './contracts.ts';
import { ApiError, toApiError } from './errors.ts';
import { http } from './http.ts';

const defaultAdapter = http.defaults.adapter;
afterEach(() => {
  http.defaults.adapter = defaultAdapter;
});

const ENTRY: RankingEntry = {
  rank: 1,
  matchId: 'match-1',
  playerId: 'player-1',
  playerName: 'Captain ABCD',
  finishedAt: '2026-10-12T12:00:00.000Z',
  score: 7,
  durationSeconds: 120,
  endReason: 'time',
  config: { sessionSeconds: 120, spawnIntervalSeconds: 5 },
  configKey: '120s-5s',
};

/** A consistent last page `number` holding `items` (earlier pages are full). */
function page<Item>(items: Item[], number = 1): Page<Item> {
  const totalItems = (number - 1) * 10 + items.length;
  return { items, page: number, pageSize: 10, totalItems, totalPages: number };
}

/** Answers every request with `respond(config)`, recording the requests. */
function fakeServer(respond: (config: InternalAxiosRequestConfig) => unknown) {
  const requests: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    requests.push(config);
    return {
      data: respond(config),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
  http.defaults.adapter = adapter;
  return requests;
}

function failWith(error: (config: InternalAxiosRequestConfig) => AxiosError) {
  http.defaults.adapter = async (config) => {
    throw error(config);
  };
}

function httpError(status: number, data: unknown) {
  return (config: InternalAxiosRequestConfig) =>
    new AxiosError('failed', AxiosError.ERR_BAD_RESPONSE, config, null, {
      data,
      status,
      statusText: 'Error',
      headers: {},
      config: { ...config, headers: new AxiosHeaders() },
    });
}

test('the ranking request carries the configuration, page and abort signal', async () => {
  const requests = fakeServer(() => page([ENTRY], 2));
  const controller = new AbortController();
  const result = await fetchRanking('120s-5s', { page: 2, pageSize: 10 }, controller.signal);
  assert.deepEqual(result.items, [ENTRY]);
  assert.equal(requests[0]!.url, '/ranking');
  assert.deepEqual(requests[0]!.params, { page: 2, pageSize: 10, configKey: '120s-5s' });
  assert.equal(requests[0]!.signal, controller.signal);
});

test('the history request targets the player, with the id encoded', async () => {
  const record = matchRecordSchema.parse(ENTRY); // drops the rank
  const requests = fakeServer(() => page<MatchRecord>([record]));
  const result = await fetchPlayerMatches('a b/c', { page: 1, pageSize: 10 });
  assert.equal(result.items[0]!.matchId, 'match-1');
  assert.equal(requests[0]!.url, '/players/a%20b%2Fc/matches');
});

test('responses that break the contract, are inconsistent or are another page, are rejected', async () => {
  for (const body of [
    '<!doctype html><title>app</title>', // a web page instead of the API
    { ...page([ENTRY]), items: [{ ...ENTRY, score: 'many' }] },
    page([ENTRY], 3), // asked for page 1
    { ...page([ENTRY]), totalPages: 2 }, // metadata that does not add up
    { ...page([ENTRY]), totalItems: 0, totalPages: 0 }, // items in an empty list
  ]) {
    fakeServer(() => body);
    await assert.rejects(fetchRanking('120s-5s', { page: 1, pageSize: 10 }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.kind, 'invalid-response');
      assert.equal(error.transient, false);
      return true;
    });
  }
});

test('timeouts, network and HTTP failures become typed errors', async () => {
  const expectations: {
    error: (config: InternalAxiosRequestConfig) => AxiosError;
    kind: string;
    status?: number;
    code?: string;
    transient: boolean;
  }[] = [
    {
      error: (config) => new AxiosError('timeout of 5000ms exceeded', 'ECONNABORTED', config),
      kind: 'timeout',
      transient: true,
    },
    {
      error: (config) => new AxiosError('timeout', 'ETIMEDOUT', config),
      kind: 'timeout',
      transient: true,
    },
    {
      error: (config) => new AxiosError('Network Error', AxiosError.ERR_NETWORK, config),
      kind: 'network',
      transient: true,
    },
    {
      error: httpError(503, { error: { code: 'unavailable', message: 'Down for repairs.' } }),
      kind: 'http',
      status: 503,
      code: 'unavailable',
      transient: true,
    },
    { error: httpError(500, 'oops'), kind: 'http', status: 500, transient: true },
    { error: httpError(429, null), kind: 'http', status: 429, transient: true },
    {
      error: httpError(400, { error: { code: 'invalid_request', message: 'Invalid page.' } }),
      kind: 'http',
      status: 400,
      code: 'invalid_request',
      transient: false,
    },
    { error: httpError(404, null), kind: 'http', status: 404, transient: false },
  ];
  for (const expected of expectations) {
    failWith(expected.error);
    await assert.rejects(fetchRanking('120s-5s', { page: 1, pageSize: 10 }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.kind, expected.kind);
      assert.equal(error.status, expected.status);
      assert.equal(error.code, expected.code);
      assert.equal(error.transient, expected.transient, `${expected.kind} ${expected.status}`);
      return true;
    });
  }
});

test('error bodies give the message shown to the player', () => {
  const config = {} as InternalAxiosRequestConfig;
  const withBody = toApiError(
    httpError(503, { error: { code: 'unavailable', message: 'Down for repairs.' } })(config),
  );
  assert.ok(withBody instanceof ApiError);
  assert.equal(withBody.message, 'Down for repairs.');
  const withoutBody = toApiError(httpError(502, '<html>')(config));
  assert.ok(withoutBody instanceof ApiError);
  assert.equal(withoutBody.message, 'The server answered with status 502.');
});

test('a cancelled request is passed through, not turned into a failure', async () => {
  failWith((config) => new AxiosError('canceled', AxiosError.ERR_CANCELED, config));
  await assert.rejects(fetchRanking('120s-5s', { page: 1, pageSize: 10 }), (error) => {
    assert.ok(!(error instanceof ApiError));
    assert.equal((error as AxiosError).code, 'ERR_CANCELED');
    return true;
  });
  const other = new Error('not axios');
  assert.equal(toApiError(other), other);
});
