// Match lifecycle tests, run in Node: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../config.ts';
import { Simulation, type InputState, type SimulationOptions } from './simulation.ts';

const IDLE: InputState = {
  forward: false,
  turnLeft: false,
  turnRight: false,
  fireFront: false,
  fireLeft: false,
  fireRight: false,
};
const EVERYTHING: InputState = {
  forward: true,
  turnLeft: true,
  turnRight: false,
  fireFront: true,
  fireLeft: true,
  fireRight: true,
};
const SPS = DEFAULT_GAME_CONFIG.simulation.stepsPerSecond;

/** The player alone at sea. */
const OPEN_SEA: SimulationOptions = { spawner: false };
/** A low-health player with a chaser about to ram it. */
const LAST_STAND: SimulationOptions = {
  spawner: false,
  playerHp: DEFAULT_GAME_CONFIG.enemies.chaser.impactDamage,
  playerStart: { x: 800, y: 450, heading: 0 },
  enemies: [{ kind: 'chaser', x: 800, y: 250, heading: Math.PI }],
};

function fullState(sim: Simulation) {
  return structuredClone({
    tick: sim.tick,
    phase: sim.phase,
    endReason: sim.endReason,
    endTick: sim.endTick,
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
    spawns: sim.spawner?.spawns,
    spawnStats: sim.spawner?.getStats(),
  });
}

function runUntilEnd(sim: Simulation, input: InputState = IDLE, limit = 10_000): void {
  while (sim.phase === 'running' && sim.tick < limit) sim.step(input);
}

test('the timer ends the match exactly after its duration in ticks', () => {
  const sim = new Simulation(DEFAULT_GAME_CONFIG, OPEN_SEA);
  const durationTicks = DEFAULT_GAME_CONFIG.match.durationSeconds * SPS;
  assert.equal(sim.durationTicks, durationTicks);

  for (let i = 0; i < durationTicks - 1; i += 1) sim.step(IDLE);
  assert.equal(sim.phase, 'running', 'the last tick is still played');
  assert.equal(sim.remainingTicks, 1);

  sim.step(IDLE);
  assert.equal(sim.phase, 'ended');
  assert.equal(sim.endReason, 'time');
  assert.equal(sim.endTick, durationTicks);
  assert.equal(sim.elapsed, DEFAULT_GAME_CONFIG.match.durationSeconds);
  assert.ok(sim.drainEvents().some((event) => event.type === 'matchEnded'));
});

test('the match ends on the tick the player ship sinks', () => {
  const sim = new Simulation(DEFAULT_GAME_CONFIG, LAST_STAND);
  let hpBefore = sim.player.hp;
  while (sim.phase === 'running' && sim.tick < 600) {
    hpBefore = sim.player.hp;
    sim.step(IDLE);
  }
  assert.equal(hpBefore, DEFAULT_GAME_CONFIG.enemies.chaser.impactDamage);
  assert.equal(sim.player.hp, 0);
  assert.equal(sim.phase, 'ended');
  assert.equal(sim.endReason, 'death');
  assert.equal(sim.endTick, sim.tick);
  assert.ok(sim.endTick! < sim.durationTicks);
});

test('sinking on the last tick of the timer ends the match by death', () => {
  // Find the tick the chaser rams, then make that the last tick of the timer.
  const probe = new Simulation(DEFAULT_GAME_CONFIG, LAST_STAND);
  runUntilEnd(probe);
  const ramTick = probe.endTick!;

  const config: GameConfig = structuredClone(DEFAULT_GAME_CONFIG);
  config.match.durationSeconds = ramTick / SPS;
  const sim = new Simulation(config, LAST_STAND);
  assert.equal(sim.durationTicks, ramTick);
  runUntilEnd(sim);
  assert.equal(sim.endTick, ramTick);
  assert.equal(sim.endReason, 'death');
});

test('an ended match is frozen: no movement, attacks, damage, spawns or scoring', () => {
  for (const options of [OPEN_SEA, LAST_STAND, { seed: 9 }] satisfies SimulationOptions[]) {
    const config: GameConfig = structuredClone(DEFAULT_GAME_CONFIG);
    config.match.durationSeconds = 10; // spawns and enemy fire are under way by then
    const sim = new Simulation(config, options);
    runUntilEnd(sim, EVERYTHING);
    assert.equal(sim.phase, 'ended');
    sim.drainEvents();

    const before = fullState(sim);
    for (let i = 0; i < 300; i += 1) sim.step(EVERYTHING);
    assert.deepEqual(fullState(sim), before);
    assert.deepEqual(sim.drainEvents(), []);
  }
});
