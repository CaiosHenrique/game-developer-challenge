import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_GAME_CONFIG } from '../src/game/config.ts';
import type { GameStateSnapshot } from '../src/game/testHooks.ts';
import { collectProblems, startGame } from './helpers.ts';

const SPS = DEFAULT_GAME_CONFIG.simulation.stepsPerSecond;
const FIRST_TICK = DEFAULT_GAME_CONFIG.spawn.firstDelaySeconds * SPS; // 120
const INTERVAL_TICKS = DEFAULT_GAME_CONFIG.spawn.intervalSeconds * SPS; // 240
const MIN_DISTANCE = DEFAULT_GAME_CONFIG.spawn.minDistanceFromPlayer;

/**
 * Steps the default match (player idle) one tick at a time until `count` enemies have
 * spawned, recording the player-to-enemy distance at the moment each one appeared.
 */
function runUntilSpawns(page: Page, count: number) {
  return page.evaluate(
    ({ wanted, limit }) => {
      const api = window.__pirateTest!;
      const distances: number[] = [];
      let state = api.getState();
      while (state.spawns.length < wanted && state.tick < limit && state.phase === 'running') {
        api.step(1);
        state = api.getState();
        for (let i = distances.length; i < state.spawns.length; i += 1) {
          const enemy = state.enemies.find((candidate) => candidate.id === state.spawns[i]!.id)!;
          distances.push(Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y));
        }
      }
      return { state, distances };
    },
    { wanted: count, limit: 60 * 60 },
  );
}

/** The parts of the match state that a replay must reproduce exactly. */
function replayed(state: GameStateSnapshot) {
  return {
    tick: state.tick,
    seed: state.seed,
    rngState: state.rngState,
    spawns: state.spawns,
    spawnStats: state.spawnStats,
    player: state.player,
    enemies: state.enemies,
    projectiles: state.projectiles,
    score: state.score,
    enemiesDestroyed: state.enemiesDestroyed,
    enemyShotsFired: state.enemyShotsFired,
  };
}

test.describe('enemy spawner', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('opens with a chaser then a shooter, on the exact cadence, far from the player', async ({
    page,
  }) => {
    await startGame(page, '?scenario=endless-spawns&seed=12345');
    const { state, distances } = await runUntilSpawns(page, 5);

    expect(state.seed).toBe(12345);
    expect(state.spawns).toHaveLength(5);
    expect(state.spawns.slice(0, 2).map((record) => record.kind)).toEqual(['chaser', 'shooter']);
    state.spawns.forEach((record, index) => {
      expect(record.scheduledTick).toBe(FIRST_TICK + index * INTERVAL_TICKS);
      expect(record.spawnTick).toBeGreaterThanOrEqual(record.scheduledTick);
    });
    expect(state.spawns[0]!.spawnTick).toBe(FIRST_TICK);
    for (const distance of distances) expect(distance).toBeGreaterThanOrEqual(MIN_DISTANCE);
    expect(state.spawnStats!.nextScheduledTick).toBe(FIRST_TICK + 5 * INTERVAL_TICKS);
  });

  test('the same seed replays the same match after a reload', async ({ page }) => {
    const play = async (seed: number) => {
      await startGame(page, `?scenario=endless-spawns&seed=${seed}`);
      return replayed((await runUntilSpawns(page, 4)).state);
    };
    const first = await play(777);
    const second = await play(777);
    expect(second).toEqual(first);

    const other = await play(778);
    expect(other.spawns.map(({ x, y, kind }) => [x, y, kind])).not.toEqual(
      first.spawns.map(({ x, y, kind }) => [x, y, kind]),
    );
  });
});
