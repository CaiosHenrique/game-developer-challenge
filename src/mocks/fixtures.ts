import { configKeyOf, type MatchConfig, type MatchRecord } from '../api/contracts.ts';
import { Rng } from '../game/sim/rng.ts';

/** Other (fictional) players of the mock API. */
const CAPTAINS = [
  'Captain Saltbeard',
  'Marla Stormwake',
  'Old Finn Hollow',
  'Captain Redsail',
  'Ida Brinewater',
  'Tobias Gull',
  'Nell Cutlass',
  'Captain Ashgrove',
  'Rook Tidewell',
  'Mae Anchorlight',
  'Silas Barnacle',
  'Captain Wren',
] as const;

/** How many matches each configuration has: the default one spans several pages. */
const FIXTURE_GROUPS: { config: MatchConfig; count: number }[] = [
  { config: { sessionSeconds: 120, spawnIntervalSeconds: 5 }, count: 34 },
  { config: { sessionSeconds: 60, spawnIntervalSeconds: 3 }, count: 12 },
  { config: { sessionSeconds: 180, spawnIntervalSeconds: 2.5 }, count: 6 },
];

const FIXTURE_SEED = 20261012;
/** First fixture match: 1 September 2026, 12:00 UTC. */
const FIRST_MATCH_AT = Date.UTC(2026, 8, 1, 12);
const HOUR_MS = 3_600_000;

/**
 * The initial records of the mock API, always the same (seeded): players, dates and scores
 * with repeated scores, so the ranking tie-break is exercised.
 */
export function fixtureRecords(): MatchRecord[] {
  const rng = new Rng(FIXTURE_SEED);
  const records: MatchRecord[] = [];
  let time = FIRST_MATCH_AT;
  for (const { config, count } of FIXTURE_GROUPS) {
    for (let index = 0; index < count; index += 1) {
      time += (1 + rng.int(30)) * HOUR_MS;
      const captain = rng.int(CAPTAINS.length);
      const sunk = rng.next() < 0.45;
      const durationSeconds = sunk
        ? 20 + rng.int(config.sessionSeconds - 20)
        : config.sessionSeconds;
      const pace = 0.2 + rng.next() * 0.5;
      const number = records.length + 1;
      records.push({
        matchId: `fixture-${String(number).padStart(3, '0')}`,
        playerId: `fixture-player-${String(captain + 1).padStart(2, '0')}`,
        playerName: CAPTAINS[captain]!,
        finishedAt: new Date(time).toISOString(),
        score: Math.round((durationSeconds / config.spawnIntervalSeconds) * pace),
        durationSeconds,
        endReason: sunk ? 'death' : 'time',
        config,
        configKey: configKeyOf(config),
      });
    }
  }
  return records;
}
