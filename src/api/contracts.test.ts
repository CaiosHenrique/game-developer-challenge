// API contracts shared by the client and the mock server: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  configKeyOf,
  matchRecordSchema,
  matchPageSchema,
  rankingEntrySchema,
  rankingQuerySchema,
  type MatchRecord,
} from './contracts.ts';

const RECORD: MatchRecord = {
  matchId: 'match-1',
  playerId: 'player-1',
  playerName: 'Captain ABCD',
  finishedAt: '2026-10-12T12:00:00.000Z',
  score: 7,
  durationSeconds: 95.5,
  endReason: 'death',
  config: { sessionSeconds: 120, spawnIntervalSeconds: 2.5 },
  configKey: '120s-2.5s',
};

test('configuration keys identify equal configurations', () => {
  assert.equal(configKeyOf({ sessionSeconds: 120, spawnIntervalSeconds: 5 }), '120s-5s');
  assert.equal(configKeyOf({ sessionSeconds: 90, spawnIntervalSeconds: 2.5 }), '90s-2.5s');
});

test('a valid match record and ranking entry pass the contract', () => {
  assert.deepEqual(matchRecordSchema.parse(RECORD), RECORD);
  assert.equal(rankingEntrySchema.parse({ ...RECORD, rank: 3 }).rank, 3);
});

test('records that break the contract are rejected', () => {
  const invalid: unknown[] = [
    { ...RECORD, configKey: '120s-5s' }, // does not match config
    {
      ...RECORD,
      config: { sessionSeconds: 120, spawnIntervalSeconds: 2.25 },
      configKey: '120s-2.25s',
    },
    { ...RECORD, config: { sessionSeconds: 30, spawnIntervalSeconds: 5 }, configKey: '30s-5s' },
    { ...RECORD, finishedAt: '12/10/2026' },
    { ...RECORD, score: -1 },
    { ...RECORD, score: 1.5 },
    { ...RECORD, endReason: 'quit' },
    { ...RECORD, matchId: '' },
  ];
  for (const record of invalid) {
    assert.equal(matchRecordSchema.safeParse(record).success, false, JSON.stringify(record));
  }
  assert.equal(rankingEntrySchema.safeParse({ ...RECORD, rank: 0 }).success, false);
});

test('ranking queries get default paging and reject invalid values', () => {
  assert.deepEqual(rankingQuerySchema.parse({ configKey: '120s-5s' }), {
    configKey: '120s-5s',
    page: 1,
    pageSize: 10,
  });
  assert.deepEqual(rankingQuerySchema.parse({ configKey: '60s-3s', page: '3', pageSize: '5' }), {
    configKey: '60s-3s',
    page: 3,
    pageSize: 5,
  });
  for (const query of [
    {},
    { configKey: 'default' },
    { configKey: '120s-5s', page: '0' },
    { configKey: '120s-5s', page: '1.5' },
    { configKey: '120s-5s', pageSize: '51' },
  ]) {
    assert.equal(rankingQuerySchema.safeParse(query).success, false, JSON.stringify(query));
  }
});

test('a page must agree with its own metadata', () => {
  const records = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ ...RECORD, matchId: `match-${index}` }));
  const page = (items: number, page: number, totalItems: number, totalPages: number) => ({
    items: records(items),
    page,
    pageSize: 10,
    totalItems,
    totalPages,
  });
  const valid = [
    page(10, 1, 25, 3), // a full page
    page(5, 3, 25, 3), // the last page holds the rest
    page(0, 1, 0, 0), // an empty list has no pages
    page(0, 4, 25, 3), // a page past the end is valid and empty
  ];
  for (const candidate of valid) {
    assert.equal(
      matchPageSchema.safeParse(candidate).success,
      true,
      JSON.stringify(candidate.items.length),
    );
  }
  const inconsistent = [
    page(11, 1, 25, 3), // more items than pageSize
    page(10, 1, 25, 2), // totalPages is not ceil(25 / 10)
    page(0, 1, 0, 1), // an empty list with one page
    page(1, 1, 0, 0), // items in an empty list
    page(0, 2, 25, 3), // a page inside the list with no items
    page(10, 3, 25, 3), // the last page with more than the rest
    page(1, 4, 25, 3), // items past the end
  ];
  for (const candidate of inconsistent) {
    assert.equal(
      matchPageSchema.safeParse(candidate).success,
      false,
      `${candidate.items.length} items, page ${candidate.page} of ${candidate.totalPages}`,
    );
  }
});
