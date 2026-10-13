// Queue of matches waiting for the online ranking: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MatchRecord } from '../api/contracts.ts';
import { createMemoryStorage } from '../mocks/storageFallback.ts';
import { STORAGE_KEYS } from './localStore.ts';
import { PendingSubmissions } from './pendingSubmissions.ts';

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

function failingWrites(storage: Storage): Storage {
  return {
    ...storage,
    getItem: storage.getItem,
    setItem: () => {
      throw new DOMException('full', 'QuotaExceededError');
    },
  } as Storage;
}

test('queued records are stored once per match and survive a reload', () => {
  const storage = createMemoryStorage();
  const queue = new PendingSubmissions(storage);
  const changes: number[] = [];
  queue.subscribe(() => changes.push(queue.list().length));
  assert.equal(queue.add(record('a')), true);
  assert.equal(queue.add(record('a')), true); // same match: not queued twice
  queue.add(record('b'));
  assert.deepEqual(
    queue.list().map((entry) => entry.matchId),
    ['a', 'b'],
  );
  assert.deepEqual(changes, [1, 2]);
  const reloaded = new PendingSubmissions(storage);
  assert.deepEqual(reloaded.list(), queue.list());
  assert.equal(reloaded.persistent, true);
});

test('removing a record is stored; a removal that cannot be stored keeps the record', () => {
  const storage = createMemoryStorage();
  const queue = new PendingSubmissions(storage);
  queue.add(record('a'));
  queue.add(record('b'));
  assert.equal(queue.remove('a'), true);
  assert.deepEqual(
    new PendingSubmissions(storage).list().map((entry) => entry.matchId),
    ['b'],
  );

  const stuck = new PendingSubmissions(failingWrites(storage));
  assert.equal(stuck.remove('b'), false);
  assert.ok(stuck.get('b'), 'kept, so it is sent again later instead of lost');
  assert.equal(queue.remove('missing'), true);
});

test('without storage, or when a write fails, the queue lives in memory and says so', () => {
  const memory = new PendingSubmissions(null);
  assert.equal(memory.persistent, false);
  assert.equal(memory.add(record('a')), false);
  assert.ok(memory.get('a'));
  assert.equal(memory.remove('a'), true);

  const storage = createMemoryStorage();
  const full = new PendingSubmissions(failingWrites(storage));
  assert.equal(full.persistent, true); // nothing written yet
  assert.equal(full.add(record('a')), false);
  assert.equal(full.persistent, false);
  assert.ok(full.get('a'));

  const blocked = {
    ...storage,
    getItem: () => {
      throw new DOMException('blocked', 'SecurityError');
    },
  } as Storage;
  assert.equal(new PendingSubmissions(blocked).persistent, false);
});

test('invalid stored entries are dropped, valid ones kept', () => {
  const storage = createMemoryStorage();
  storage.setItem(
    STORAGE_KEYS.pendingMatches,
    JSON.stringify([record('ok'), { matchId: 'broken' }, 42]),
  );
  assert.deepEqual(
    new PendingSubmissions(storage).list().map((entry) => entry.matchId),
    ['ok'],
  );
  storage.setItem(STORAGE_KEYS.pendingMatches, 'not json');
  assert.deepEqual(new PendingSubmissions(storage).list(), []);
  storage.setItem(STORAGE_KEYS.pendingMatches, '{"not":"a list"}');
  assert.deepEqual(new PendingSubmissions(storage).list(), []);
});

test('two tabs sharing the queue never write over each other’s matches', () => {
  const storage = createMemoryStorage();
  // Both tabs are open (and have read the empty queue) before either match ends.
  const tabA = new PendingSubmissions(storage);
  const tabB = new PendingSubmissions(storage);
  tabA.add(record('A'));
  tabB.add(record('B')); // used to write [B] from its stale copy, losing A
  assert.deepEqual(
    new PendingSubmissions(storage).list().map((entry) => entry.matchId),
    ['A', 'B'],
  );
  tabA.remove('A'); // used to write [] from its stale copy, losing B
  assert.deepEqual(
    new PendingSubmissions(storage).list().map((entry) => entry.matchId),
    ['B'],
  );
  // The other tab picks up the change (the app calls this on the `storage` event).
  const changes: string[][] = [];
  tabB.subscribe(() => changes.push(tabB.list().map((entry) => entry.matchId)));
  tabB.refresh();
  assert.deepEqual(changes, [['B']]);
  tabB.refresh(); // nothing new: no notification
  assert.equal(changes.length, 1);
});
