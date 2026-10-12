// Enemy navigation soak test, run in Node: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ISLAND_COLLIDERS } from '../arena.ts';
import { DEFAULT_GAME_CONFIG } from '../config.ts';
import type { EnemyKind } from './ai.ts';
import { circleAabbPush } from './geometry.ts';
import { hullCircles, Simulation, type InputState } from './simulation.ts';

const IDLE: InputState = {
  forward: false,
  turnLeft: false,
  turnRight: false,
  fireFront: false,
  fireLeft: false,
  fireRight: false,
};

const STEPS_PER_SECOND = DEFAULT_GAME_CONFIG.simulation.stepsPerSecond;
const TIME_LIMIT_TICKS = 40 * STEPS_PER_SECOND;
/** Only floating-point rounding is tolerated when checking for island overlap. */
const FLOAT_EPSILON = 1e-9;

/** Player positions, including ones lined up behind each island (head-on approaches). */
const PLAYER_POSITIONS = [
  { x: 800, y: 450 },
  { x: 800, y: 300 }, // level with the grass island
  { x: 800, y: 230 }, // level with the north-east sand island
  { x: 800, y: 660 }, // level with the south-east sand island
];

/** Enemy start positions around the arena edges, skipping any that overlap an island. */
function edgePositions(): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];
  for (let x = 100; x <= 1500; x += 200) positions.push({ x, y: 60 }, { x, y: 840 });
  for (let y = 150; y <= 750; y += 150) positions.push({ x: 60, y }, { x: 1540, y });
  return positions;
}

function islandOverlap(sim: Simulation, kind: EnemyKind): number {
  let deepest = 0;
  for (const enemy of sim.enemies) {
    for (const circle of hullCircles(enemy, DEFAULT_GAME_CONFIG.enemies[kind].hull)) {
      for (const island of ISLAND_COLLIDERS) {
        const push = circleAabbPush(circle, island);
        if (push) deepest = Math.max(deepest, Math.hypot(push.x, push.y));
      }
    }
  }
  return deepest;
}

/**
 * Every enemy, from every start position, must reach its goal (a chaser rams the player,
 * a shooter fires at it) without ever overlapping an island.
 */
for (const kind of ['chaser', 'shooter'] as const) {
  test(`${kind}s navigate around islands from every edge position`, () => {
    let runs = 0;
    let slowestTicks = 0;
    for (const player of PLAYER_POSITIONS) {
      for (const start of edgePositions()) {
        const sim = new Simulation(DEFAULT_GAME_CONFIG, {
          playerStart: { ...player, heading: 0 },
          enemies: [{ kind, ...start, heading: 0 }],
        });
        const label = `${kind} from (${start.x},${start.y}) to player (${player.x},${player.y})`;
        let reached = false;
        while (!reached && sim.tick < TIME_LIMIT_TICKS) {
          sim.step(IDLE);
          const overlap = islandOverlap(sim, kind);
          assert.ok(overlap <= FLOAT_EPSILON, `${label}: overlaps an island by ${overlap}`);
          reached =
            kind === 'chaser' ? sim.enemiesDestroyed.ramming === 1 : sim.enemyShotsFired > 0;
        }
        assert.ok(reached, `${label}: did not reach its goal within 40 s`);
        slowestTicks = Math.max(slowestTicks, sim.tick);
        runs += 1;
      }
    }
    console.log(`${kind}: ${runs} runs, slowest goal at ${(slowestTicks / 60).toFixed(1)} s`);
  });
}

test('an enemy overlapping an island is pushed out of it in the next step', () => {
  // Grass island collider spans x 312..548; this chaser's hull starts inside its right shore.
  const sim = new Simulation(DEFAULT_GAME_CONFIG, {
    playerStart: { x: 800, y: 300, heading: 0 },
    enemies: [{ kind: 'chaser', x: 560, y: 300, heading: Math.PI / 2 }],
  });
  assert.ok(islandOverlap(sim, 'chaser') > 10, 'the scenario starts overlapping');
  sim.step(IDLE);
  assert.ok(islandOverlap(sim, 'chaser') <= FLOAT_EPSILON);
});

test('without obstacle feelers, the unstuck manoeuvre alone gets a chaser around an island', () => {
  const config = structuredClone(DEFAULT_GAME_CONFIG);
  config.enemies.ai.feelerLength = 0; // feelers see nothing
  // Head-on: the grass island lies exactly between the chaser and the player.
  const sim = new Simulation(config, {
    playerStart: { x: 800, y: 300, heading: 0 },
    enemies: [{ kind: 'chaser', x: 100, y: 300, heading: Math.PI / 2 }],
  });
  while (sim.enemiesDestroyed.ramming === 0 && sim.tick < TIME_LIMIT_TICKS) {
    sim.step(IDLE);
    assert.ok(islandOverlap(sim, 'chaser') <= FLOAT_EPSILON);
  }
  assert.equal(sim.enemiesDestroyed.ramming, 1, 'reached the player');
});
