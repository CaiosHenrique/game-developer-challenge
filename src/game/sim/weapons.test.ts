// Pure simulation tests, run in Node without a browser or PixiJS: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../config.ts';
import { segmentAabbEntry } from './geometry.ts';
import { Simulation, type InputState } from './simulation.ts';

const IDLE: InputState = {
  forward: false,
  turnLeft: false,
  turnRight: false,
  fireFront: false,
  fireLeft: false,
  fireRight: false,
};

function withWeapons(overrides: Partial<GameConfig['weapons']['front']>): GameConfig {
  const config = structuredClone(DEFAULT_GAME_CONFIG);
  Object.assign(config.weapons.front, overrides);
  return config;
}

test('segmentAabbEntry finds the entry point of a segment crossing a box', () => {
  const box = { minX: 80, minY: 0, maxX: 120, maxY: 100 };
  assert.equal(segmentAabbEntry(0, 50, 200, 50, box), 0.4);
  assert.equal(segmentAabbEntry(0, 150, 200, 150, box), null);
  assert.equal(segmentAabbEntry(100, 50, 300, 50, box), 0);
  assert.equal(segmentAabbEntry(100, -50, 100, 50, box), 0.5);
});

test('a projectile faster than an island is wide still hits it (no tunnelling)', () => {
  // 30000 units/s is 500 units per step: more than the grass island width (236).
  const simulation = new Simulation(withWeapons({ speed: 30_000, range: 100_000 }));
  Object.assign(simulation.player, { x: 800, y: 300, heading: -Math.PI / 2 }); // facing left
  simulation.step({ ...IDLE, fireFront: true });
  simulation.drainEvents();

  simulation.step(IDLE);
  const removed = simulation.drainEvents().find((event) => event.type === 'projectileRemoved');
  assert.ok(removed && removed.type === 'projectileRemoved');
  assert.equal(removed.reason, 'island');
  // Stopped at the island's right shore (548) plus the projectile radius.
  assert.ok(Math.abs(removed.x - 553) < 1e-6, `hit at x=${removed.x}`);
  assert.equal(simulation.projectiles.length, 0);
});

test('weapon cooldowns are exact whole ticks', () => {
  const simulation = new Simulation(DEFAULT_GAME_CONFIG);
  const cooldownTicks = Math.round(DEFAULT_GAME_CONFIG.weapons.front.cooldown * 60); // 36
  const firing = { ...IDLE, fireFront: true };

  simulation.step(firing);
  assert.equal(simulation.shotsFired.front, 1);
  for (let tick = 1; tick < cooldownTicks; tick += 1) simulation.step(firing);
  assert.equal(simulation.shotsFired.front, 1, 'must not fire before the cooldown ends');
  simulation.step(firing);
  assert.equal(simulation.shotsFired.front, 2, 'fires on the exact tick the cooldown ends');
});

test('broadsides fire perpendicular to the current heading', () => {
  const simulation = new Simulation(DEFAULT_GAME_CONFIG);
  simulation.player.heading = Math.PI / 2; // facing right: port side is up, starboard is down
  simulation.step({ ...IDLE, fireLeft: true, fireRight: true });

  const speed = DEFAULT_GAME_CONFIG.weapons.side.speed;
  const left = simulation.projectiles.filter((p) => p.weapon === 'left');
  const right = simulation.projectiles.filter((p) => p.weapon === 'right');
  assert.equal(left.length, 3);
  assert.equal(right.length, 3);
  for (const p of left) {
    assert.ok(Math.abs(p.vx) < 1e-9 && Math.abs(p.vy + speed) < 1e-9);
  }
  for (const p of right) {
    assert.ok(Math.abs(p.vx) < 1e-9 && Math.abs(p.vy - speed) < 1e-9);
  }
});
