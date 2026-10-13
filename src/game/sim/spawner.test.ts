// Spawner and determinism tests, run in Node: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARENA_BOUNDS, ISLAND_COLLIDERS, SPAWN_POINTS } from '../arena.ts';
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../config.ts';
import { circleAabbPush, circleBoundsPush } from './geometry.ts';
import { Rng } from './rng.ts';
import { hullsOverlap } from './ships.ts';
import { Simulation, type InputState } from './simulation.ts';

const IDLE: InputState = {
  forward: false,
  turnLeft: false,
  turnRight: false,
  fireFront: false,
  fireLeft: false,
  fireRight: false,
};
const SPS = DEFAULT_GAME_CONFIG.simulation.stepsPerSecond;
const FIRST_TICK = DEFAULT_GAME_CONFIG.spawn.firstDelaySeconds * SPS; // 120
const INTERVAL_TICKS = DEFAULT_GAME_CONFIG.spawn.intervalSeconds * SPS;

/** A fixed, varied command pattern: sailing, turning both ways and firing every weapon. */
function scriptedInput(tick: number): InputState {
  return {
    forward: tick % 400 < 300,
    turnLeft: tick % 240 < 40,
    turnRight: tick % 500 > 450,
    fireFront: tick % 3 === 0,
    fireLeft: tick % 7 === 0,
    fireRight: tick % 11 === 0,
  };
}

/**
 * Spawner tests watch long matches: the player can neither sink nor run out of time, so the
 * match end (tested separately) never interrupts what is being measured.
 */
const ENDLESS: GameConfig = structuredClone(DEFAULT_GAME_CONFIG);
ENDLESS.match.durationSeconds = 3600;
ENDLESS.player.maxHp = 1_000_000;

function withSpawn(overrides: Partial<GameConfig['spawn']>): GameConfig {
  const config = structuredClone(ENDLESS);
  Object.assign(config.spawn, overrides);
  return config;
}

/** Everything that defines the state of a match, for determinism comparisons. */
function fullState(sim: Simulation) {
  return structuredClone({
    tick: sim.tick,
    seed: sim.seed,
    rngState: sim.rngState,
    player: sim.player,
    enemies: sim.enemies,
    projectiles: sim.projectiles,
    score: sim.score,
    enemiesDestroyed: sim.enemiesDestroyed,
    weaponReadyAt: sim.weaponReadyAt,
    shotsFired: sim.shotsFired,
    enemyShotsFired: sim.enemyShotsFired,
    projectilesRemoved: sim.projectilesRemoved,
    phase: sim.phase,
    endReason: sim.endReason,
    endTick: sim.endTick,
    spawns: sim.spawner?.spawns,
    spawnStats: sim.spawner?.getStats(),
  });
}

test('the RNG replays the same sequence for the same seed', () => {
  const a = new Rng(42);
  const b = new Rng(42);
  const c = new Rng(43);
  const sequenceA = Array.from({ length: 1000 }, () => a.next());
  const sequenceB = Array.from({ length: 1000 }, () => b.next());
  const sequenceC = Array.from({ length: 1000 }, () => c.next());
  assert.deepEqual(sequenceA, sequenceB);
  assert.notDeepEqual(sequenceA, sequenceC);
  assert.ok(sequenceA.every((value) => value >= 0 && value < 1));
});

test('every spawn point fits a hull in any orientation, inside the arena and off the islands', () => {
  for (const kind of ['chaser', 'shooter'] as const) {
    const { radius, offset } = DEFAULT_GAME_CONFIG.enemies[kind].hull;
    for (const point of SPAWN_POINTS) {
      const reach = { x: point.x, y: point.y, radius: radius + offset };
      const outside = circleBoundsPush(reach, ARENA_BOUNDS);
      assert.deepEqual(outside, { x: 0, y: 0 }, `(${point.x},${point.y}) leaves the arena`);
      for (const island of ISLAND_COLLIDERS) {
        assert.equal(circleAabbPush(reach, island), null, `(${point.x},${point.y}) on an island`);
      }
    }
  }
});

test('the spawn configuration cannot place an enemy within immediate firing reach', () => {
  const { spawn, enemies } = DEFAULT_GAME_CONFIG;
  assert.ok(spawn.minDistanceFromPlayer > enemies.shooter.attackRange);
  assert.ok(spawn.minDistanceFromPlayer > enemies.shooter.weapon.range);
  assert.ok(spawn.weights.chaser + spawn.weights.shooter > 0);
  assert.deepEqual([...spawn.openingKinds].sort(), ['chaser', 'shooter']);
});

test('spawns follow the fixed cadence exactly', () => {
  const sim = new Simulation(ENDLESS, { seed: 7 });
  // Long enough for at least five scheduled spawns.
  while (sim.tick <= FIRST_TICK + 5 * INTERVAL_TICKS && sim.phase === 'running') sim.step(IDLE);
  const spawns = sim.spawner!.spawns;
  assert.ok(spawns.length >= 5);
  spawns.forEach((record, index) => {
    assert.equal(record.scheduledTick, FIRST_TICK + index * INTERVAL_TICKS);
    assert.equal(record.spawnTick, record.scheduledTick, 'a valid point was always available');
  });
});

test('every match opens with a chaser and then a shooter', () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const sim = new Simulation(ENDLESS, { seed });
    while (sim.spawner!.spawns.length < 2 && sim.phase === 'running') sim.step(IDLE);
    assert.deepEqual(
      sim.spawner!.spawns.map((record) => record.kind),
      ['chaser', 'shooter'],
      `seed ${seed}`,
    );
  }
});

test('enemies appear far from the player and clear of every living hull', () => {
  const { minDistanceFromPlayer } = DEFAULT_GAME_CONFIG.spawn;
  let checked = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    const sim = new Simulation(ENDLESS, { seed });
    let known = 0;
    while (sim.tick < 120 * SPS && sim.phase === 'running') {
      sim.step(scriptedInput(sim.tick));
      const spawns = sim.spawner!.spawns;
      for (; known < spawns.length; known += 1) {
        const record = spawns[known]!;
        const enemy = sim.enemies.find((candidate) => candidate.id === record.id)!;
        // State after the step is the state at the spawn: nothing moves after phase 9.
        assert.deepEqual([enemy.x, enemy.y], [record.x, record.y]);
        const distance = Math.hypot(enemy.x - sim.player.x, enemy.y - sim.player.y);
        assert.ok(distance >= minDistanceFromPlayer, `seed ${seed}: spawned ${distance} away`);
        assert.equal(record.distanceToPlayer, distance);
        const hull = DEFAULT_GAME_CONFIG.enemies[enemy.kind].hull;
        assert.ok(!hullsOverlap(enemy, hull, sim.player, DEFAULT_GAME_CONFIG.player.hull));
        for (const other of sim.enemies) {
          if (other === enemy) continue;
          const otherHull = DEFAULT_GAME_CONFIG.enemies[other.kind].hull;
          assert.ok(!hullsOverlap(enemy, hull, other, otherHull), `seed ${seed}: overlaps`);
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked > 400, `${checked} spawns checked`);
});

test('the alive cap skips scheduled spawns without moving the cadence', () => {
  const config = withSpawn({
    intervalSeconds: 1,
    maxAlive: 3,
    weights: { chaser: 0, shooter: 1 },
    openingKinds: [],
  });
  const sim = new Simulation(config, { seed: 3 });
  let mostAlive = 0;
  while (sim.tick < 30 * SPS && sim.phase === 'running') {
    sim.step(IDLE);
    mostAlive = Math.max(mostAlive, sim.enemies.length);
  }
  const stats = sim.spawner!.getStats();
  assert.equal(mostAlive, 3);
  assert.ok(stats.skippedAtCap > 0);
  const first = config.spawn.firstDelaySeconds * SPS;
  for (const record of sim.spawner!.spawns) {
    assert.equal((record.scheduledTick - first) % SPS, 0, 'scheduled on the 1 s cadence');
  }
  // The next scheduled tick is the first cadence tick not yet processed.
  assert.equal(stats.nextScheduledTick, first + Math.ceil((sim.tick - first) / SPS) * SPS);
});

test('a deferred spawn appears once a point is valid, checked on that tick', () => {
  // Player near the left edge: once released, only the far (right-hand) points are valid,
  // so a spawn placed without re-checking the distance would show up in some seed.
  for (let seed = 1; seed <= 10; seed += 1) {
    const config = withSpawn({ minDistanceFromPlayer: 5000 }); // no point is far enough
    const sim = new Simulation(config, { seed, playerStart: { x: 100, y: 450, heading: 0 } });
    while (sim.tick < 200 && sim.phase === 'running') sim.step(IDLE);
    assert.equal(sim.spawner!.spawns.length, 0);
    assert.equal(sim.spawner!.getStats().deferredTicks, 200 - FIRST_TICK);

    config.spawn.minDistanceFromPlayer = 900;
    sim.step(IDLE);
    const [record] = sim.spawner!.spawns;
    assert.equal(record!.scheduledTick, FIRST_TICK);
    assert.equal(record!.spawnTick, 200);
    assert.ok(record!.distanceToPlayer >= 900, `seed ${seed}: ${record!.distanceToPlayer}`);
  }
});

test('a pending spawn replaced by the next one keeps the cadence and the opening kinds', () => {
  // Several seeds: the second kind would otherwise come from a 50/50 weighted roll.
  for (let seed = 1; seed <= 10; seed += 1) {
    const config = withSpawn({ minDistanceFromPlayer: 5000 });
    const sim = new Simulation(config, { seed });
    // Scheduled at FIRST_TICK (stays pending), then at the next cadence tick, which replaces it.
    const second = FIRST_TICK + INTERVAL_TICKS;
    const release = second + 40;
    while (sim.tick < release && sim.phase === 'running') sim.step(IDLE);
    assert.equal(sim.spawner!.getStats().replaced, 1);

    config.spawn.minDistanceFromPlayer = 450;
    while (sim.spawner!.spawns.length < 2 && sim.phase === 'running') sim.step(IDLE);
    const [firstSpawn, secondSpawn] = sim.spawner!.spawns;
    assert.deepEqual(
      [firstSpawn!.kind, firstSpawn!.scheduledTick, firstSpawn!.spawnTick],
      ['chaser', second, release],
    );
    assert.deepEqual(
      [secondSpawn!.kind, secondSpawn!.scheduledTick],
      ['shooter', FIRST_TICK + 2 * INTERVAL_TICKS],
      `seed ${seed}`,
    );
  }
});

test('kind weights decide the kinds after the opening ones', () => {
  for (const [weights, only] of [
    [{ chaser: 1, shooter: 0 }, 'chaser'],
    [{ chaser: 0, shooter: 1 }, 'shooter'],
  ] as const) {
    const sim = new Simulation(withSpawn({ weights, intervalSeconds: 1, maxAlive: 50 }), {
      seed: 11,
    });
    while (sim.tick < 40 * SPS && sim.phase === 'running') sim.step(IDLE);
    const kinds = sim.spawner!.spawns.map((record) => record.kind);
    assert.deepEqual(kinds.slice(0, 2), ['chaser', 'shooter']);
    assert.ok(kinds.length > 10);
    assert.ok(
      kinds.slice(2).every((kind) => kind === only),
      `${only} only`,
    );
  }
});

test('the same seed and inputs replay the same match; another seed does not', () => {
  const play = (seed: number) => {
    const sim = new Simulation(DEFAULT_GAME_CONFIG, { seed });
    const checkpoints: unknown[] = [];
    // Default config: the match may end (by time or by sinking); both runs must agree.
    while (sim.tick < 120 * SPS && sim.phase === 'running') {
      sim.step(scriptedInput(sim.tick));
      if (sim.tick % (10 * SPS) === 0) checkpoints.push(fullState(sim));
    }
    return { final: fullState(sim), checkpoints, spawns: sim.spawner!.spawns };
  };
  const a = play(2024);
  const b = play(2024);
  assert.deepEqual(a.checkpoints, b.checkpoints);
  assert.deepEqual(a.final, b.final);

  const other = play(2025);
  assert.notDeepEqual(
    other.spawns.map(({ x, y, kind }) => [x, y, kind]),
    a.spawns.map(({ x, y, kind }) => [x, y, kind]),
  );
  assert.notDeepEqual(other.final, a.final);
});
