// Retry policy and late responses with the real TanStack Query client (no React):
// `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepPreviousData, QueryObserver, type QueryClient } from '@tanstack/react-query';
import { ApiError } from './errors.ts';
import { createQueryClient, queryKeys, retryDelay, shouldRetry } from './queries.ts';

/** A promise resolved from outside, to decide the order in which responses arrive. */
function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

/**
 * A query function whose calls never finish on their own: each call records its signal and
 * waits for the test to answer it, ignoring the abort (like a server that answers anyway).
 */
function controlledFetch() {
  const calls: { key: unknown; signal: AbortSignal; answer: (value: string) => void }[] = [];
  const queryFn = ({ queryKey, signal }: { queryKey: readonly unknown[]; signal: AbortSignal }) => {
    const { promise, resolve } = deferred<string>();
    calls.push({ key: queryKey, signal, answer: resolve });
    return promise;
  };
  return { calls, queryFn };
}

function observe(
  client: QueryClient,
  page: number,
  queryFn: ReturnType<typeof controlledFetch>['queryFn'],
) {
  const optionsFor = (page: number) => ({
    queryKey: queryKeys.rankingPage('120s-5s', page),
    queryFn,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const observer = new QueryObserver(client, optionsFor(page));
  const unsubscribe = observer.subscribe(() => {});
  return { observer, unsubscribe, optionsFor };
}

test('only transient errors are retried, at most twice', () => {
  const transient = [
    new ApiError('timeout', 'slow'),
    new ApiError('network', 'down'),
    new ApiError('http', 'error', 500),
    new ApiError('http', 'busy', 503),
    new ApiError('http', 'too many', 429),
  ];
  for (const error of transient) {
    assert.equal(shouldRetry(0, error), true, error.kind);
    assert.equal(shouldRetry(1, error), true, error.kind);
    assert.equal(shouldRetry(2, error), false, error.kind);
  }
  const permanent = [
    new ApiError('http', 'bad', 400),
    new ApiError('http', 'missing', 404),
    new ApiError('invalid-response', 'garbage'),
    new Error('unknown'),
  ];
  for (const error of permanent) assert.equal(shouldRetry(0, error), false, error.message);
  assert.deepEqual([0, 1, 2, 3].map(retryDelay), [1000, 2000, 4000, 4000]);
});

test('a late answer to a replaced request never overwrites the newer data', async () => {
  const client = createQueryClient();
  const { calls, queryFn } = controlledFetch();
  const { observer, unsubscribe } = observe(client, 1, queryFn);
  await settle();
  calls[0]!.answer('first');
  await settle();

  // A slow refresh is still in flight when a newer one replaces it (e.g. after an
  // invalidation): the slow one is aborted.
  void observer.refetch();
  await settle();
  void observer.refetch({ cancelRefetch: true });
  await settle();
  assert.equal(calls.length, 3);
  assert.equal(calls[1]!.signal.aborted, true);

  calls[2]!.answer('new');
  await settle();
  calls[1]!.answer('old'); // the server answers the aborted request anyway, later
  await settle();
  assert.equal(observer.getCurrentResult().data, 'new');
  assert.equal(client.getQueryData(queryKeys.rankingPage('120s-5s', 1)), 'new');
  unsubscribe();
  client.clear();
});

test('a late answer for the previous page is never shown as the current page', async () => {
  const client = createQueryClient();
  const { calls, queryFn } = controlledFetch();
  const { observer, unsubscribe, optionsFor } = observe(client, 1, queryFn);
  await settle();
  calls[0]!.answer('page 1');
  await settle();

  // The player moves to page 2 while page 1 refreshes slowly.
  void observer.refetch();
  await settle();
  observer.setOptions(optionsFor(2));
  await settle();
  const page2 = calls.find((call) => JSON.stringify(call.key).endsWith('2]'))!;
  // While page 2 loads, page 1 stays on screen, marked as a placeholder.
  assert.equal(observer.getCurrentResult().data, 'page 1');
  assert.equal(observer.getCurrentResult().isPlaceholderData, true);

  page2.answer('page 2');
  await settle();
  calls[1]!.answer('page 1 (late)'); // the slow page-1 refresh arrives after page 2
  await settle();
  const current = observer.getCurrentResult();
  assert.equal(current.data, 'page 2');
  assert.equal(current.isPlaceholderData, false);
  unsubscribe();
  client.clear();
});
