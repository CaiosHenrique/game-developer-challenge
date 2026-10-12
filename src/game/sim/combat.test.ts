// Pure simulation tests, run in Node without a browser or PixiJS: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../config.ts';
import { headingTowards, wrapAngle } from './ai.ts';
import { Simulation, type InputState, type SimulationOptions } from './simulation.ts';

const IDLE: InputState = {
  forward: false,
  turnLeft: false,
  turnRight: false,
  fireFront: false,
  fireLeft: false,
  fireRight: false,
};

/** Player weapons fast enough to cross the arena in one step, so hits are immediate. */
function fastGuns(): GameConfig {
  const config = structuredClone(DEFAULT_GAME_CONFIG);
  for (const weapon of [config.weapons.front, config.weapons.side]) {
    weapon.speed = 30_000;
    weapon.range = 100_000;
  }
  return config;
}

/** Fixed placements only: the spawner is off so no other enemy appears. */
function simulation(options: SimulationOptions, config: GameConfig = DEFAULT_GAME_CONFIG) {
  return new Simulation(config, { spawner: false, ...options });
}

test('a projectile damages only the first ship along its path, exactly once', () => {
  const sim = simulation(
    {
      playerStart: { x: 800, y: 450, heading: -Math.PI / 2 }, // facing left
      enemies: [
        { kind: 'chaser', x: 650, y: 450, heading: Math.PI / 2 },
        { kind: 'chaser', x: 450, y: 450, heading: Math.PI / 2 },
      ],
    },
    fastGuns(),
  );
  const [first, second] = sim.enemies;
  sim.step({ ...IDLE, fireFront: true });
  sim.step(IDLE);

  const damage = DEFAULT_GAME_CONFIG.weapons.front.damage;
  assert.equal(first!.hp, first!.maxHp - damage);
  assert.equal(second!.hp, second!.maxHp);
  assert.equal(sim.projectilesRemoved.ship, 1);
  assert.equal(sim.projectiles.length, 0);

  for (let i = 0; i < 30; i += 1) sim.step(IDLE);
  assert.equal(first!.hp, first!.maxHp - damage, 'the projectile is gone: no further damage');
});

test('an enemy destroyed by one projectile cannot be hit by the next ones in the same step', () => {
  // Player facing up: the left broadside fires three parallel balls to the west in one step
  // (at y = 572, 600 and 628, clear of every island).
  const sim = simulation(
    {
      playerStart: { x: 800, y: 600, heading: 0 },
      enemies: [
        { kind: 'chaser', x: 650, y: 600, heading: Math.PI / 2 },
        { kind: 'shooter', x: 450, y: 600, heading: Math.PI / 2 },
      ],
    },
    fastGuns(),
  );
  const [chaser, shooter] = sim.enemies;
  chaser!.hp = DEFAULT_GAME_CONFIG.weapons.side.damage; // one ball destroys it
  sim.step({ ...IDLE, fireLeft: true });
  sim.step(IDLE);

  assert.equal(chaser!.alive, false);
  assert.ok(!sim.enemies.includes(chaser!), 'removed in the same step');
  // The two other balls passed through its position and hit the shooter behind it.
  assert.equal(shooter!.hp, shooter!.maxHp - 2 * DEFAULT_GAME_CONFIG.weapons.side.damage);
  assert.equal(sim.score, 1);
});

test('a destroyed shooter does not fire in that step and loses its projectiles in flight', () => {
  const sim = simulation(
    {
      playerStart: { x: 800, y: 450, heading: 0 },
      enemies: [{ kind: 'shooter', x: 800, y: 150, heading: Math.PI }], // 300 away, aiming
    },
    fastGuns(),
  );
  const shooter = sim.enemies[0]!;
  sim.step(IDLE);
  assert.equal(sim.enemyShotsFired, 1, 'in range and aimed: it fires');
  const enemyBall = sim.projectiles.find((p) => p.ownerId === shooter.id)!;

  // The player fires its front gun and a broadside (which flies away from the shooter).
  shooter.hp = DEFAULT_GAME_CONFIG.weapons.front.damage;
  sim.step({ ...IDLE, fireFront: true, fireLeft: true });
  const playerBalls = sim.projectiles.filter((p) => p.ownerId === 0).map((p) => p.id);
  assert.equal(playerBalls.length, 4);

  // Ready to fire again in the very step it is destroyed.
  shooter.weaponReadyAt = 0;
  sim.step(IDLE);

  assert.equal(shooter.alive, false);
  assert.equal(sim.enemyShotsFired, 1, 'a destroyed shooter does not fire');
  assert.ok(!sim.projectiles.some((p) => p.id === enemyBall.id), 'its ball is removed');
  assert.equal(sim.projectilesRemoved.ownerDestroyed, 1);
  // The player's broadside is untouched (its balls are still flying or expired normally).
  assert.equal(sim.projectilesRemoved.ship, 1);
  assert.equal(sim.player.hp, sim.player.maxHp);
});

test('a ramming chaser damages the player once, is destroyed and does not score', () => {
  const sim = simulation({
    playerStart: { x: 800, y: 450, heading: 0 },
    enemies: [{ kind: 'chaser', x: 800, y: 250, heading: Math.PI }],
  });
  let steps = 0;
  while (sim.enemies.length > 0 && steps < 600) {
    sim.step(IDLE);
    steps += 1;
  }
  const { impactDamage } = DEFAULT_GAME_CONFIG.enemies.chaser;
  assert.equal(sim.enemies.length, 0);
  assert.equal(sim.player.hp, sim.player.maxHp - impactDamage);
  assert.deepEqual(sim.enemiesDestroyed, { playerFire: 0, ramming: 1 });
  assert.equal(sim.score, 0);

  for (let i = 0; i < 120; i += 1) sim.step(IDLE);
  assert.equal(sim.player.hp, sim.player.maxHp - impactDamage, 'damage is applied once');
});

test('destroying an enemy with the player guns scores exactly one point', () => {
  const sim = simulation(
    {
      playerStart: { x: 800, y: 700, heading: 0 },
      enemies: [{ kind: 'chaser', x: 800, y: 200, heading: Math.PI }],
    },
    fastGuns(),
  );
  let steps = 0;
  while (sim.enemies.length > 0 && steps < 600) {
    sim.step({ ...IDLE, fireFront: true });
    steps += 1;
  }
  assert.equal(sim.score, 1);
  assert.deepEqual(sim.enemiesDestroyed, { playerFire: 1, ramming: 0 });
  assert.equal(sim.player.hp, sim.player.maxHp);
});

test('a shooter closes in, stops near its preferred range and fires only in range and aimed', () => {
  const config = DEFAULT_GAME_CONFIG;
  const shooterConfig = config.enemies.shooter;
  const { maxSpeed, deceleration } = shooterConfig.movement;
  const stepSeconds = 1 / config.simulation.stepsPerSecond;
  // Closest it can get: it stops accelerating at the preferred range, then brakes.
  const brakingDistance = (maxSpeed * maxSpeed) / (2 * deceleration) + maxSpeed * stepSeconds;
  const cooldownTicks = Math.round(
    shooterConfig.weapon.cooldown * config.simulation.stepsPerSecond,
  );

  const sim = simulation({
    playerStart: { x: 800, y: 800, heading: 0 },
    enemies: [{ kind: 'shooter', x: 800, y: 100, heading: Math.PI }],
  });
  const shooter = sim.enemies[0]!;
  const shotTicks: number[] = [];
  const playerHits: number[] = [];
  let closest = Infinity;
  for (let tick = 0; tick < 20 * config.simulation.stepsPerSecond; tick += 1) {
    const shotsBefore = sim.enemyShotsFired;
    sim.step(IDLE);
    for (const event of sim.drainEvents()) {
      if (event.type === 'shipHit' && event.targetId === 0) playerHits.push(event.damage);
    }
    const distance = Math.hypot(sim.player.x - shooter.x, sim.player.y - shooter.y);
    closest = Math.min(closest, distance);
    if (sim.enemyShotsFired > shotsBefore) {
      shotTicks.push(sim.tick - 1);
      assert.ok(distance <= shooterConfig.attackRange, `fired from ${distance}`);
      const offAxis = Math.abs(wrapAngle(headingTowards(shooter, sim.player) - shooter.heading));
      assert.ok(offAxis <= shooterConfig.fireCone, `fired ${offAxis} rad off axis`);
    }
  }

  assert.ok(shotTicks.length >= 2, `fired ${shotTicks.length} times`);
  for (let i = 1; i < shotTicks.length; i += 1) {
    assert.equal(
      shotTicks[i]! - shotTicks[i - 1]!,
      cooldownTicks,
      'fires again exactly on cooldown',
    );
  }
  assert.ok(closest >= shooterConfig.preferredRange - brakingDistance, `came within ${closest}`);
  // Every hit on the player deals exactly the shooter weapon damage (hp is floored at 0).
  assert.ok(playerHits.length >= 1 && playerHits.length <= shotTicks.length);
  assert.ok(playerHits.every((damage) => damage === shooterConfig.weapon.damage));
  assert.equal(
    sim.player.hp,
    Math.max(0, sim.player.maxHp - playerHits.length * shooterConfig.weapon.damage),
  );
});
