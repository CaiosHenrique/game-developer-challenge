// The online record of a stored result: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StoredResult } from '../storage/localStore.ts';
import { matchRecordFrom } from './matchRecord.ts';

const PLAYER = { playerId: 'player-1', playerName: 'Captain P1' };
const RESULT: StoredResult = {
  matchId: 'match-1',
  finishedAt: '2026-10-12T12:00:00.000Z',
  score: 6,
  timePlayedSeconds: 87.5,
  reason: 'death',
  options: { sessionSeconds: 90, spawnIntervalSeconds: 2.5 },
};

test('the record keeps every field of the result as it was recorded', () => {
  assert.deepEqual(matchRecordFrom(RESULT, PLAYER), {
    matchId: 'match-1',
    playerId: 'player-1',
    playerName: 'Captain P1',
    finishedAt: '2026-10-12T12:00:00.000Z',
    score: 6,
    durationSeconds: 87.5,
    endReason: 'death',
    config: { sessionSeconds: 90, spawnIntervalSeconds: 2.5 },
    configKey: '90s-2.5s',
  });
  // A confirmation date on the result is not part of the record.
  assert.deepEqual(
    matchRecordFrom({ ...RESULT, submittedAt: '2026-10-12T12:01:00.000Z' }, PLAYER),
    matchRecordFrom(RESULT, PLAYER),
  );
});

test('a result that cannot make a valid record gives none', () => {
  const broken: StoredResult[] = [
    { ...RESULT, finishedAt: 'yesterday' },
    { ...RESULT, options: { sessionSeconds: 1000, spawnIntervalSeconds: 5 } },
    { ...RESULT, score: -1 },
    { ...RESULT, matchId: '' },
  ];
  for (const result of broken) assert.equal(matchRecordFrom(result, PLAYER), null);
});
