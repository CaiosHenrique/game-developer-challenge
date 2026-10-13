// Match submission protocol with the real TanStack Query client (no React):
// `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryObserver } from '@tanstack/react-query';
import { createMemoryStorage } from '../mocks/storageFallback.ts';
import {
  loadLastResultExact,
  markResultSubmitted,
  saveLastResult,
  STORAGE_KEYS,
} from '../storage/localStore.ts';
import { PendingSubmissions } from '../storage/pendingSubmissions.ts';
import type { MatchRecord } from './contracts.ts';
import { ApiError } from './errors.ts';
import { matchRecordFrom } from './matchRecord.ts';
import { createQueryClient, queryKeys } from './queries.ts';
import {
  MatchSubmitter,
  submissionKeys,
  submissionStatus,
  visiblePending,
  type SubmissionAttempt,
} from './submissions.ts';

function record(matchId: string): MatchRecord {
  return {
    matchId,
    playerId: 'player-1',
    playerName: 'Captain P',
    finishedAt: '2026-10-12T12:00:00.000Z',
    score: 3,
    durationSeconds: 120,
    endReason: 'time',
    config: { sessionSeconds: 120, spawnIntervalSeconds: 5 },
    configKey: '120s-5s',
  };
}

/** A server that answers each send with the next planned outcome (then succeeds). */
function server(plan: (Error | 'ok')[] = []) {
  const sent: string[] = [];
  const submit = async (match: MatchRecord) => {
    sent.push(match.matchId);
    const outcome = plan.shift() ?? 'ok';
    if (outcome !== 'ok') throw outcome;
    return match;
  };
  return { sent, submit };
}

function setup(
  options: {
    plan?: (Error | 'ok')[];
    mark?: 'updated' | 'not-current' | 'failed';
    storage?: Storage | null;
  } = {},
) {
  const client = createQueryClient();
  const queue = new PendingSubmissions(
    options.storage === undefined ? createMemoryStorage() : options.storage,
  );
  const { sent, submit } = server(options.plan);
  const marked: string[] = [];
  const submitter = new MatchSubmitter(client, queue, {
    submit,
    markSubmitted: (matchId) => {
      marked.push(matchId);
      return options.mark ?? 'updated';
    },
    now: () => '2026-10-12T12:05:00.000Z',
    retryDelay: () => 1,
  });
  const lastAttempt = (matchId: string) =>
    client
      .getMutationCache()
      .findAll({ mutationKey: submissionKeys.match(matchId), exact: true })
      .at(-1)?.state;
  return { client, queue, submitter, sent, marked, lastAttempt };
}

const unavailable = () => new ApiError('http', 'Down for repairs.', 503);

test('a confirmed match is recorded, leaves the queue and refreshes both tabs', async () => {
  const { client, queue, submitter, sent, marked, lastAttempt } = setup();
  client.setQueryData(queryKeys.rankingPage('120s-5s', 1), 'old ranking');
  client.setQueryData(queryKeys.historyPage('player-1', 1), 'old history');
  queue.add(record('m1'));
  await submitter.submit('m1');
  assert.deepEqual(sent, ['m1']);
  assert.deepEqual(marked, ['m1']);
  assert.equal(queue.get('m1'), undefined);
  assert.equal(lastAttempt('m1')?.status, 'success');
  await new Promise((done) => setTimeout(done, 0)); // requests in flight are cancelled first
  assert.equal(client.getQueryState(queryKeys.rankingPage('120s-5s', 1))?.isInvalidated, true);
  assert.equal(client.getQueryState(queryKeys.historyPage('player-1', 1))?.isInvalidated, true);
});

test('only one send of a match is in flight, whatever triggers it', async () => {
  const { queue, submitter, sent } = setup();
  queue.add(record('m1'));
  await Promise.all([
    submitter.submit('m1'),
    submitter.submit('m1'),
    (submitter.submitAll(), Promise.resolve()),
  ]);
  assert.deepEqual(sent, ['m1']);
  await submitter.submit('m1'); // no longer queued: nothing to send
  assert.deepEqual(sent, ['m1']);
});

test('transient failures are retried twice, then the match stays queued', async () => {
  const { queue, submitter, sent, marked, lastAttempt } = setup({
    plan: [unavailable(), unavailable(), unavailable()],
  });
  queue.add(record('m1'));
  await submitter.submit('m1');
  assert.equal(sent.length, 3); // first send + 2 retries
  assert.ok(queue.get('m1'));
  assert.deepEqual(marked, []);
  assert.equal(lastAttempt('m1')?.status, 'error');

  await submitter.submit('m1'); // Retry: the server is back
  assert.equal(sent.length, 4);
  assert.equal(queue.get('m1'), undefined);
});

test('a conflict or another permanent error is not retried automatically', async () => {
  const conflict = new ApiError('http', 'Another record already uses this match id.', 409);
  const { queue, submitter, sent, lastAttempt } = setup({ plan: [conflict] });
  queue.add(record('m1'));
  await submitter.submit('m1');
  assert.equal(sent.length, 1);
  assert.ok(queue.get('m1'));
  assert.equal(lastAttempt('m1')?.error, conflict);

  const invalid = setup({ plan: [new ApiError('invalid-response', 'garbage')] });
  invalid.queue.add(record('m2'));
  await invalid.submitter.submit('m2');
  assert.equal(invalid.sent.length, 1);
});

test('when the local record of a confirmation fails, the match stays queued and recovers', async () => {
  const storage = createMemoryStorage();
  const first = setup({ mark: 'failed', storage });
  first.queue.add(record('m1'));
  await first.submitter.submit('m1');
  assert.equal(first.lastAttempt('m1')?.status, 'success'); // the server has it: no failure
  assert.ok(first.queue.get('m1'), 'kept until this device can record the confirmation');

  // Later in the same session: no second send, only the local step again.
  await first.submitter.submit('m1');
  assert.deepEqual(first.sent, ['m1']);

  // After a reload, it is sent again (the server answers idempotently) and finished.
  const reloaded = setup({ storage });
  assert.ok(reloaded.queue.get('m1'));
  reloaded.submitter.submitAll();
  await reloaded.submitter.submit('m1');
  await new Promise((done) => setTimeout(done, 10));
  assert.deepEqual(reloaded.sent, ['m1']);
  assert.equal(reloaded.queue.get('m1'), undefined);
});

test('a queue that cannot be stored drops confirmed matches (nothing to recover)', async () => {
  const { queue, submitter } = setup({ mark: 'failed', storage: null });
  queue.add(record('m1'));
  await submitter.submit('m1');
  assert.equal(queue.get('m1'), undefined);
});

test('a match stands where its queue entry and last attempt say', () => {
  const attempt = (status: SubmissionAttempt['status'], error: unknown = null) => ({
    status,
    error,
  });
  const conflict = new ApiError('http', 'conflict', 409);
  const cases: [Parameters<typeof submissionStatus>[0], string][] = [
    [{ queued: true, attempt: attempt('pending') }, 'submitting'],
    [{ queued: true, attempt: attempt('success') }, 'submitted'], // local step still pending
    [{ queued: false, attempt: undefined, submittedAt: '2026-10-12T12:05:00Z' }, 'submitted'],
    [{ queued: true, attempt: attempt('error', unavailable()) }, 'failed'],
    [{ queued: true, attempt: attempt('error', conflict) }, 'conflict'],
    [{ queued: true, attempt: undefined }, 'waiting'],
    [{ queued: false, attempt: undefined }, 'not-submitted'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(submissionStatus(input), expected, JSON.stringify(input));
  }
});

test('the history lists pending matches once, never one the server already shows', () => {
  const queued = [record('confirmed'), record('on-server'), record('waiting')];
  const attempts = new Map<string, SubmissionAttempt>([
    ['confirmed', { status: 'success', error: null }],
  ]);
  assert.deepEqual(
    visiblePending(queued, attempts, new Set(['on-server'])).map((match) => match.matchId),
    ['waiting'],
  );
});

test('a confirmed match whose queue and confirmation could not be stored is recovered after a reload', async () => {
  // Storage keeps the result but refuses the queue, then refuses the confirmation.
  const storage = createMemoryStorage();
  const setItem = storage.setItem;
  let refuseResult = false;
  storage.setItem = (key, value) => {
    if (key === STORAGE_KEYS.pendingMatches || (refuseResult && key === STORAGE_KEYS.lastResult)) {
      throw new DOMException('full', 'QuotaExceededError');
    }
    setItem(key, value);
  };
  const result = {
    matchId: 'm1',
    finishedAt: '2026-10-12T12:00:00.000Z',
    score: 3,
    timePlayedSeconds: 120,
    reason: 'time' as const,
    options: { sessionSeconds: 120, spawnIntervalSeconds: 5 },
  };
  const player = { playerId: 'player-1', playerName: 'Captain P' };
  saveLastResult(result, storage);
  const serverRecords = new Map<string, MatchRecord>();
  const idempotentServer = async (match: MatchRecord) => {
    const existing = serverRecords.get(match.matchId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(match)) {
      throw new ApiError('http', 'Another record already uses this match id.', 409);
    }
    serverRecords.set(match.matchId, match);
    return match;
  };
  const session = (submit = idempotentServer) => {
    const queue = new PendingSubmissions(storage);
    const submitter = new MatchSubmitter(createQueryClient(), queue, {
      submit,
      markSubmitted: (matchId, at) => markResultSubmitted(matchId, at, storage),
      retryDelay: () => 1,
    });
    return { queue, submitter };
  };

  const first = session();
  first.queue.add(matchRecordFrom(result, player)!);
  assert.equal(first.queue.persistent, false);
  refuseResult = true;
  await first.submitter.submit('m1');
  assert.ok(serverRecords.has('m1')); // the server has it...

  // ...but after a reload this device has no trace of the confirmation, nor a queue entry.
  refuseResult = false;
  const reloaded = session();
  const stored = loadLastResultExact(storage)!;
  assert.equal(stored.submittedAt, undefined);
  assert.equal(
    submissionStatus({ queued: false, attempt: undefined, submittedAt: stored.submittedAt }),
    'not-submitted',
  );
  // Submit rebuilds the same record from the stored result; the server recognises it.
  const rebuilt = matchRecordFrom(stored, player)!;
  assert.deepEqual(rebuilt, serverRecords.get('m1'));
  reloaded.queue.add(rebuilt);
  await reloaded.submitter.submit('m1');
  assert.equal(serverRecords.size, 1);
  assert.equal(reloaded.queue.get('m1'), undefined);
  assert.ok(loadLastResultExact(storage)?.submittedAt);
});

test('a recovered record the server holds differently is a conflict, kept in the queue', async () => {
  const storage = createMemoryStorage();
  const queue = new PendingSubmissions(storage);
  const conflict = new ApiError('http', 'Another record already uses this match id.', 409);
  const submitter = new MatchSubmitter(createQueryClient(), queue, {
    submit: async () => {
      throw conflict;
    },
    markSubmitted: () => 'updated',
  });
  queue.add(record('m1'));
  await submitter.submit('m1');
  assert.ok(queue.get('m1'), 'not discarded');
  assert.ok(new PendingSubmissions(storage).get('m1'), 'still stored for a later Retry');
});

test('a confirmed match refreshes a list whose first load was still in flight', async () => {
  const { client, queue, submitter } = setup();
  // The history's first load started before the match was registered and has no data yet.
  const requests: string[] = [];
  const observer = new QueryObserver(client, {
    queryKey: queryKeys.historyPage('player-1', 1),
    queryFn: () =>
      new Promise<string>((answer) => {
        requests.push(requests.length === 0 ? 'before the match' : 'after the match');
        if (requests.length > 1) answer('with the match');
      }),
    retry: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  await new Promise((done) => setTimeout(done, 0));
  queue.add(record('m1'));
  await submitter.submit('m1');
  await new Promise((done) => setTimeout(done, 0));
  assert.deepEqual(requests, ['before the match', 'after the match']);
  assert.equal(observer.getCurrentResult().data, 'with the match');
  unsubscribe();
});
