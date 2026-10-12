import type { EnemyConfig, GameConfig } from '../config.ts';
import { expandAabb, headingVector, segmentAabbEntry, type Aabb } from './geometry.ts';
import type { Ship, ShipControls } from './ships.ts';

export type EnemyKind = 'chaser' | 'shooter';

export type Enemy = Ship & {
  id: number;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Tick from which the enemy may fire again (shooters only). */
  weaponReadyAt: number;
  /** Consecutive ticks spent barely moving while sailing. */
  stuckTicks: number;
  /** While the tick is below this, the enemy turns away to escape an obstacle. */
  unstuckUntil: number;
};

/** Heading (0 = up, clockwise) that points from one position towards another. */
export function headingTowards(from: { x: number; y: number }, to: { x: number; y: number }) {
  return Math.atan2(to.x - from.x, -(to.y - from.y));
}

/** Angle wrapped to (-PI, PI]. */
export function wrapAngle(angle: number): number {
  const wrapped = angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/** Turn command (-1..1) that rotates `heading` towards `desired` without overshooting. */
function turnTowards(heading: number, desired: number, maxTurnPerStep: number): number {
  const difference = wrapAngle(desired - heading);
  return Math.max(-1, Math.min(1, difference / maxTurnPerStep));
}

/**
 * Two rays ahead of the bow, at +/- feelerAngle, tested against the islands (expanded by
 * the hull radius). Returns a turn away from an island ahead, or null when the way is clear.
 */
function avoidIslands(
  enemy: Enemy,
  hullRadius: number,
  obstacles: readonly Aabb[],
  ai: GameConfig['enemies']['ai'],
): number | null {
  const feelerHit = (angle: number): number | null => {
    const direction = headingVector(enemy.heading + angle);
    const endX = enemy.x + direction.x * ai.feelerLength;
    const endY = enemy.y + direction.y * ai.feelerLength;
    let nearest: number | null = null;
    for (const obstacle of obstacles) {
      const entry = segmentAabbEntry(
        enemy.x,
        enemy.y,
        endX,
        endY,
        expandAabb(obstacle, hullRadius),
      );
      if (entry !== null && (nearest === null || entry < nearest)) nearest = entry;
    }
    return nearest;
  };

  const left = feelerHit(-ai.feelerAngle);
  const right = feelerHit(ai.feelerAngle);
  if (left === null && right === null) return null;
  if (left === null) return -1; // blocked on the right: turn left
  if (right === null) return 1; // blocked on the left: turn right
  // Both blocked: turn towards the side whose obstacle is farther; ties turn right.
  return left > right ? -1 : 1;
}

/**
 * Decides what an enemy does this step. Chasers always sail towards the player; shooters
 * close in to their preferred range, then stop and aim. Both steer around islands and,
 * when stuck against one, turn away to a fixed side for a moment.
 */
export function enemyControls(
  enemy: Enemy,
  kindConfig: EnemyConfig,
  target: Ship,
  config: GameConfig,
  obstacles: readonly Aabb[],
  tick: number,
): ShipControls {
  const dt = 1 / config.simulation.stepsPerSecond;
  const maxTurnPerStep = kindConfig.movement.turnRate * dt;

  if (tick < enemy.unstuckUntil) {
    // Odd ids escape to the right, even ids to the left, so neighbours do not mirror.
    return { throttle: true, turn: enemy.id % 2 === 1 ? 1 : -1 };
  }

  const aim = turnTowards(enemy.heading, headingTowards(enemy, target), maxTurnPerStep);

  if (enemy.kind === 'shooter') {
    const { preferredRange } = config.enemies.shooter;
    const distance = Math.hypot(target.x - enemy.x, target.y - enemy.y);
    if (distance <= preferredRange) return { throttle: false, turn: aim };
  }

  const avoid = avoidIslands(enemy, kindConfig.hull.radius, obstacles, config.enemies.ai);
  return { throttle: true, turn: avoid ?? aim };
}
