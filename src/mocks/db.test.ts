// Mock API data: fixtures, ranking order, pagination and storage fallback: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  configKeyOf,
  matchPageSchema,
  matchRecordSchema,
  rankingPageSchema,
  type MatchRecord,
} from '../api/contracts.ts';
import { compareRanking, MOCK_DB_KEY, MockDb, paginate } from './db.ts';
import { fixtureRecords, manyPagesHistory, manyPagesRanking } from './fixtures.ts';
import { createMemoryStorage } from './storageFallback.ts';

const CONFIG = { sessionSeconds: 120, spawnIntervalSeconds: 5 };

function record(overrides: Partial<MatchRecord>): MatchRecord {
  return {
    matchId: 'm',
    playerId: 'p',
    playerName: 'Captain P',
    finishedAt: '2026-10-01T10:00:00.000Z',
    score: 0,
    durationSeconds: 120,
    endReason: 'time',
    config: CONFIG,
    configKey: configKeyOf(CONFIG),
    ...overrides,
  };
}

const blockedStorage = {
  ...createMemoryStorage(),
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
} as Storage;

test('fixtures are always the same, valid, and span several pages', () => {
  const fixtures = fixtureRecords();
  assert.deepEqual(fixtureRecords(), fixtures);
  for (const fixture of fixtures) matchRecordSchema.parse(fixture);
  assert.equal(new Set(fixtures.map((fixture) => fixture.matchId)).size, fixtures.length);
  const defaults = fixtures.filter((fixture) => fixture.configKey === '120s-5s');
  assert.ok(defaults.length > 30, 'the default setup has more than three pages');
  const scores = defaults.map((fixture) => fixture.score);
  assert.ok(new Set(scores).size < scores.length, 'some scores repeat (tie-break in use)');
});

test('ranking: higher score first, then the earlier match, then the match id', () => {
  const records = [
    record({ matchId: 'c', score: 5, finishedAt: '2026-10-02T10:00:00.000Z' }),
    record({ matchId: 'b', score: 5, finishedAt: '2026-10-01T10:00:00.000Z' }),
    record({ matchId: 'a', score: 5, finishedAt: '2026-10-01T10:00:00.000Z' }),
    record({ matchId: 'd', score: 9, finishedAt: '2026-10-09T10:00:00.000Z' }),
    record({ matchId: 'e', score: 1, finishedAt: '2026-09-01T10:00:00.000Z' }),
  ];
  const db = new MockDb(null, () => records);
  const ranking = db.ranking('120s-5s', 1, 10);
  assert.deepEqual(
    ranking.items.map((entry) => [entry.rank, entry.matchId]),
    [
      [1, 'd'],
      [2, 'a'],
      [3, 'b'],
      [4, 'c'],
      [5, 'e'],
    ],
  );
  // The order does not depend on the order the records were stored in.
  const reversed = new MockDb(null, () => [...records].reverse());
  assert.deepEqual(reversed.ranking('120s-5s', 1, 10), ranking);
  assert.equal(compareRanking(records[2]!, records[2]!), 0);
});

test('ranking compares only matches played with the same configuration', () => {
  const other = { sessionSeconds: 60, spawnIntervalSeconds: 3 };
  const db = new MockDb(null, () => [
    record({ matchId: 'a', score: 3 }),
    record({ matchId: 'b', score: 50, config: other, configKey: configKeyOf(other) }),
  ]);
  assert.deepEqual(
    db.ranking('120s-5s', 1, 10).items.map((entry) => entry.matchId),
    ['a'],
  );
  assert.equal(db.ranking('60s-3s', 1, 10).items[0]!.rank, 1);
  assert.equal(db.ranking('75s-5s', 1, 10).totalItems, 0);
});

test('pages are stable, ranks continue across pages, and a page past the end is empty', () => {
  const db = new MockDb(null);
  const first = db.ranking('120s-5s', 1, 10);
  const all = db.ranking('120s-5s', 1, 50);
  assert.equal(first.totalItems, all.totalItems);
  assert.equal(first.totalPages, Math.ceil(all.totalItems / 10));
  const pages = Array.from({ length: first.totalPages }, (_, index) =>
    db.ranking('120s-5s', index + 1, 10),
  );
  assert.deepEqual(
    pages.flatMap((page) => page.items),
    all.items,
  );
  assert.deepEqual(
    all.items.map((entry) => entry.rank),
    all.items.map((_, index) => index + 1),
  );
  for (const page of pages) rankingPageSchema.parse(page);

  const past = db.ranking('120s-5s', first.totalPages + 1, 10);
  assert.deepEqual(past.items, []);
  assert.equal(past.totalPages, first.totalPages);
  assert.deepEqual(paginate([], 1, 10), {
    items: [],
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 0,
  });
});

test('history lists one player, most recent first', () => {
  const db = new MockDb(null, () => [
    record({ matchId: 'old', playerId: 'me', finishedAt: '2026-10-01T10:00:00.000Z' }),
    record({ matchId: 'new', playerId: 'me', finishedAt: '2026-10-03T10:00:00.000Z' }),
    record({ matchId: 'same-b', playerId: 'me', finishedAt: '2026-10-02T10:00:00.000Z' }),
    record({ matchId: 'same-a', playerId: 'me', finishedAt: '2026-10-02T10:00:00.000Z' }),
    record({ matchId: 'theirs', playerId: 'someone' }),
  ]);
  const history = db.playerMatches('me', 1, 10);
  assert.deepEqual(
    history.items.map((match) => match.matchId),
    ['new', 'same-a', 'same-b', 'old'],
  );
  matchPageSchema.parse(history);
  assert.equal(db.playerMatches('nobody', 1, 10).totalItems, 0);
});

test('with storage the data is kept; corrupted data falls back to the fixtures', () => {
  const storage = createMemoryStorage();
  const db = new MockDb(storage, () => [record({ matchId: 'stored', score: 4 })]);
  assert.equal(db.persistence, 'local');
  assert.ok(storage.getItem(MOCK_DB_KEY)?.includes('stored'));
  // A later page load reads the stored data instead of the fixtures.
  const reloaded = new MockDb(storage, () => [record({ matchId: 'fixture' })]);
  assert.equal(reloaded.ranking('120s-5s', 1, 10).items[0]!.matchId, 'stored');

  for (const corrupted of ['not json', '{"records":[{"matchId":1}]}', '{}']) {
    storage.setItem(MOCK_DB_KEY, corrupted);
    const db2 = new MockDb(storage, () => [record({ matchId: 'fixture' })]);
    assert.equal(db2.ranking('120s-5s', 1, 10).items[0]!.matchId, 'fixture');
  }
});

test('without usable storage the data lives in memory, without failing', () => {
  for (const storage of [null, blockedStorage]) {
    const db = new MockDb(storage, () => [record({ matchId: 'fixture' })]);
    assert.equal(db.persistence, 'memory');
    assert.equal(db.ranking('120s-5s', 1, 10).totalItems, 1);
  }
});

test('registering a match is idempotent; another record under the same id is a conflict', () => {
  const storage = createMemoryStorage();
  const db = new MockDb(storage, () => []);
  const match = record({ matchId: 'mine', score: 7 });
  assert.equal(db.upsert(match).outcome, 'created');
  // The same record again (even with keys in another order) returns the stored one.
  const reordered = { ...match, config: { spawnIntervalSeconds: 5, sessionSeconds: 120 } };
  assert.deepEqual(db.upsert(reordered), { outcome: 'existing', record: match });
  const changed = db.upsert({ ...match, score: 8 });
  assert.equal(changed.outcome, 'conflict');
  assert.equal(changed.record.score, 7);
  assert.equal(db.ranking('120s-5s', 1, 10).totalItems, 1);
  // The registered match is stored for the next page load.
  assert.equal(new MockDb(storage, () => []).ranking('120s-5s', 1, 10).totalItems, 1);
});

test('read-only storage: stored data is still read, new records live in memory', () => {
  const storage = createMemoryStorage();
  new MockDb(storage, () => [record({ matchId: 'stored' })]);
  const readOnly = {
    ...storage,
    getItem: storage.getItem,
    setItem: () => {
      throw new DOMException('full', 'QuotaExceededError');
    },
  } as Storage;
  const db = new MockDb(readOnly, () => [record({ matchId: 'fixture' })]);
  assert.equal(db.persistence, 'memory');
  assert.equal(db.ranking('120s-5s', 1, 10).items[0]!.matchId, 'stored');
  assert.equal(db.upsert(record({ matchId: 'new' })).outcome, 'created');
  assert.equal(db.ranking('120s-5s', 1, 10).totalItems, 2);
});

test('a write that fails after start-up switches to memory and tells the listeners', () => {
  const storage = createMemoryStorage();
  const db = new MockDb(storage, () => []);
  const changes: string[] = [];
  db.onPersistenceChange((persistence) => changes.push(persistence));
  assert.equal(db.persistence, 'local');
  storage.setItem = () => {
    throw new DOMException('full', 'QuotaExceededError');
  };
  assert.equal(db.upsert(record({ matchId: 'late' })).outcome, 'created');
  assert.equal(db.persistence, 'memory');
  assert.deepEqual(changes, ['memory']);
  assert.equal(db.ranking('120s-5s', 1, 10).totalItems, 1); // still served this session
  db.upsert(record({ matchId: 'later' }));
  assert.deepEqual(changes, ['memory']); // told once
});

test('two tabs registering matches never lose each other’s confirmed records', () => {
  const storage = createMemoryStorage();
  // Each tab runs its own mock API over the same storage.
  const tabA = new MockDb(storage, () => []);
  const tabB = new MockDb(storage, () => []);
  assert.equal(tabA.upsert(record({ matchId: 'A', playerId: 'me' })).outcome, 'created');
  assert.equal(tabB.upsert(record({ matchId: 'B', playerId: 'me' })).outcome, 'created');
  const ids = (db: MockDb) => db.playerMatches('me', 1, 10).items.map((match) => match.matchId);
  assert.deepEqual(ids(new MockDb(storage, () => [])).sort(), ['A', 'B']); // after a reload
  assert.deepEqual(ids(tabA).sort(), ['A', 'B']); // tab A sees tab B's match
  // Sending A again from tab B is recognised (idempotent), not stored twice.
  assert.equal(tabB.upsert(record({ matchId: 'A', playerId: 'me' })).outcome, 'existing');
});

test('in memory, a tab keeps its own records instead of re-reading storage', () => {
  const storage = createMemoryStorage();
  const db = new MockDb(storage, () => []);
  storage.setItem = () => {
    throw new DOMException('full', 'QuotaExceededError');
  };
  db.upsert(record({ matchId: 'only-in-memory', playerId: 'me' }));
  assert.equal(db.persistence, 'memory');
  assert.equal(db.playerMatches('me', 1, 10).totalItems, 1);
});

test('reset restores the fixtures, stored for the next page load', () => {
  const storage = createMemoryStorage();
  const db = new MockDb(storage, () => [record({ matchId: 'fixture' })]);
  db.upsert(record({ matchId: 'mine', score: 9 }));
  assert.equal(db.ranking('120s-5s', 1, 10).totalItems, 2);
  db.reset();
  assert.deepEqual(
    db.ranking('120s-5s', 1, 10).items.map((entry) => entry.matchId),
    ['fixture'],
  );
  assert.equal(new MockDb(storage, () => []).ranking('120s-5s', 1, 10).totalItems, 1);
});

test('extra records are listed in one answer only, never stored', () => {
  const storage = createMemoryStorage();
  const db = new MockDb(storage, () => [record({ matchId: 'fixture', playerId: 'me' })]);
  const before = storage.getItem(MOCK_DB_KEY);
  const extra = [record({ matchId: 'extra', playerId: 'me', score: 50 })];
  assert.equal(db.ranking('120s-5s', 1, 10, extra).items[0]!.matchId, 'extra');
  assert.equal(db.playerMatches('me', 1, 10, extra).totalItems, 2);
  assert.equal(db.ranking('120s-5s', 1, 10).totalItems, 1);
  assert.equal(storage.getItem(MOCK_DB_KEY), before);
});

test('many-pages data is generated the same way every time and fits the contract', () => {
  const ranking = manyPagesRanking('120s-5s');
  assert.deepEqual(manyPagesRanking('120s-5s'), ranking);
  assert.equal(ranking.length, 200);
  for (const match of ranking) matchRecordSchema.parse(match);
  assert.equal(new Set(ranking.map((match) => match.matchId)).size, ranking.length);
  assert.ok(ranking.every((match) => match.configKey === '120s-5s'));
  assert.deepEqual(manyPagesRanking('not-a-key'), []);
  const history = manyPagesHistory('me', 'Captain ME');
  assert.equal(history.length, 45);
  assert.ok(history.every((match) => match.playerId === 'me'));
  for (const match of history) matchRecordSchema.parse(match);
  // A full answer with the extra matches is a valid, consistent page.
  const db = new MockDb(null);
  rankingPageSchema.parse(db.ranking('120s-5s', 3, 10, ranking));
});
