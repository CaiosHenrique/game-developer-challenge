// Local storage access, run in Node with an in-memory Storage: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_OPTIONS } from '../game/options.ts';
import {
  loadLastResult,
  loadLastResultExact,
  loadOptions,
  loadOrCreatePlayer,
  markResultSubmitted,
  playerNameFor,
  saveLastResult,
  saveOptions,
  STORAGE_KEYS,
  type StoredResult,
} from './localStore.ts';

/** In-memory Storage; `failReads` / `failWrites` make it throw like a blocked or full one. */
function memoryStorage({ failReads = false, failWrites = false } = {}) {
  const data = new Map<string, string>();
  let writes = 0;
  const storage = {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem(key: string) {
      if (failReads) throw new DOMException('blocked', 'SecurityError');
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (failWrites) throw new DOMException('full', 'QuotaExceededError');
      writes += 1;
      data.set(key, value);
    },
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
  } satisfies Storage;
  return { storage, data, writes: () => writes };
}

const RESULT: StoredResult = {
  matchId: 'match-1',
  finishedAt: '2026-10-12T12:00:00.000Z',
  score: 7,
  timePlayedSeconds: 120,
  reason: 'time',
  options: { sessionSeconds: 120, spawnIntervalSeconds: 5 },
};

test('options round-trip and fall back to defaults when missing or corrupted', () => {
  const { storage, data } = memoryStorage();
  assert.deepEqual(loadOptions(storage), DEFAULT_OPTIONS);
  assert.equal(saveOptions({ sessionSeconds: 90, spawnIntervalSeconds: 2 }, storage), true);
  assert.deepEqual(loadOptions(storage), { sessionSeconds: 90, spawnIntervalSeconds: 2 });

  data.set(STORAGE_KEYS.options, '{not json');
  assert.deepEqual(loadOptions(storage), DEFAULT_OPTIONS);
  data.set(STORAGE_KEYS.options, JSON.stringify({ sessionSeconds: 1000, spawnIntervalSeconds: 3 }));
  assert.deepEqual(loadOptions(storage), { ...DEFAULT_OPTIONS, spawnIntervalSeconds: 3 });
});

test('a stored result is written once per match id', () => {
  const { storage, writes } = memoryStorage();
  assert.equal(saveLastResult(RESULT, storage), 'saved');
  assert.equal(saveLastResult({ ...RESULT, finishedAt: 'later' }, storage), 'duplicate');
  assert.equal(writes(), 1);
  assert.equal(loadLastResult(storage)?.finishedAt, RESULT.finishedAt);

  assert.equal(saveLastResult({ ...RESULT, matchId: 'match-2' }, storage), 'saved');
  assert.equal(loadLastResult(storage)?.matchId, 'match-2');
});

test('invalid or corrupted stored results are ignored', () => {
  const { storage, data } = memoryStorage();
  data.set(STORAGE_KEYS.lastResult, '{broken');
  assert.equal(loadLastResult(storage), null);
  data.set(STORAGE_KEYS.lastResult, JSON.stringify({ ...RESULT, score: -1 }));
  assert.equal(loadLastResult(storage), null);
  data.set(STORAGE_KEYS.lastResult, JSON.stringify({ ...RESULT, reason: 'quit' }));
  assert.equal(loadLastResult(storage), null);
});

test('unavailable storage never throws and reports failed writes', () => {
  for (const options of [{ failReads: true, failWrites: true }, { failWrites: true }]) {
    const { storage } = memoryStorage(options);
    assert.deepEqual(loadOptions(storage), DEFAULT_OPTIONS);
    assert.equal(saveOptions(DEFAULT_OPTIONS, storage), false);
    assert.equal(loadLastResult(storage), null);
    assert.equal(saveLastResult(RESULT, storage), 'failed');
  }
  assert.equal(saveLastResult(RESULT, null), 'failed');
  assert.deepEqual(loadOptions(null), DEFAULT_OPTIONS);
});

test('the player identity is created once and then reused', () => {
  const { storage } = memoryStorage();
  const first = loadOrCreatePlayer(storage, () => 'abc123-player');
  assert.deepEqual(first, {
    playerId: 'abc123-player',
    playerName: 'Captain ABC1',
    persisted: true,
  });
  const again = loadOrCreatePlayer(storage, () => 'another-id');
  assert.deepEqual(again, first);
});

test('a corrupted player identity is replaced', () => {
  const { storage, data } = memoryStorage();
  data.set(STORAGE_KEYS.player, '{"playerId":""}');
  assert.equal(loadOrCreatePlayer(storage, () => 'fresh-id').playerId, 'fresh-id');
  data.set(STORAGE_KEYS.player, 'not json');
  assert.equal(loadOrCreatePlayer(storage, () => 'other-id').playerId, 'other-id');
});

test('without storage the player identity lasts for this page load only', () => {
  for (const storage of [null, memoryStorage({ failReads: true, failWrites: true }).storage]) {
    const player = loadOrCreatePlayer(storage, () => 'session-id');
    assert.equal(player.playerId, 'session-id');
    assert.equal(player.persisted, false);
  }
  assert.equal(playerNameFor('---'), 'Captain X');
});

test('the confirmation of a submitted match is recorded on the stored result once', () => {
  const { storage, writes } = memoryStorage();
  saveLastResult(RESULT, storage);
  assert.equal(
    markResultSubmitted('other-match', '2026-10-12T12:05:00.000Z', storage),
    'not-current',
  );
  assert.equal(markResultSubmitted(RESULT.matchId, '2026-10-12T12:05:00.000Z', storage), 'updated');
  assert.equal(loadLastResult(storage)?.submittedAt, '2026-10-12T12:05:00.000Z');
  const before = writes();
  assert.equal(markResultSubmitted(RESULT.matchId, '2026-10-13T00:00:00.000Z', storage), 'updated');
  assert.equal(writes(), before); // already recorded: no second write
  assert.equal(loadLastResult(storage)?.submittedAt, '2026-10-12T12:05:00.000Z');
});

test('recording a confirmation reports storage failures', () => {
  const failing = memoryStorage({ failWrites: true });
  failing.data.set(STORAGE_KEYS.lastResult, JSON.stringify(RESULT));
  assert.equal(
    markResultSubmitted(RESULT.matchId, '2026-10-12T12:05:00.000Z', failing.storage),
    'failed',
  );
  assert.equal(
    markResultSubmitted(RESULT.matchId, 'x', memoryStorage({ failReads: true }).storage),
    'failed',
  );
  assert.equal(markResultSubmitted(RESULT.matchId, 'x', null), 'failed');
});

test('the exact stored result keeps its options; damaged options make it unusable', () => {
  const { storage, data } = memoryStorage();
  saveLastResult(RESULT, storage);
  assert.deepEqual(loadLastResultExact(storage), RESULT);
  const damaged = { ...RESULT, options: { sessionSeconds: 1000, spawnIntervalSeconds: 5 } };
  data.set(STORAGE_KEYS.lastResult, JSON.stringify(damaged));
  assert.equal(loadLastResultExact(storage), null); // never sent with made-up options
  assert.deepEqual(loadLastResult(storage)?.options, DEFAULT_OPTIONS); // still shown
});
