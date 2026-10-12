import type { WeaponConfig } from '../config.ts';
import {
  expandAabb,
  headingVector,
  pointInAabb,
  segmentAabbEntry,
  segmentCircleEntry,
  type Aabb,
  type Circle,
} from './geometry.ts';

export type WeaponSlot = 'front' | 'left' | 'right';

export const WEAPON_SLOTS: readonly WeaponSlot[] = ['front', 'left', 'right'];

export type Faction = 'player' | 'enemy';

/** Owner id of projectiles fired by the player (enemy ids start at 1). */
export const PLAYER_ID = 0;

export type Projectile = {
  id: number;
  owner: Faction;
  /** Ship that fired it: PLAYER_ID or an enemy id. */
  ownerId: number;
  weapon: WeaponSlot;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  /** Simulation steps the projectile has moved. */
  age: number;
  /** It expires after this many steps (its range divided by its speed). */
  lifeTicks: number;
};

export type ProjectileRemoval = 'island' | 'outOfBounds' | 'expired' | 'ship' | 'ownerDestroyed';

/** A ship a projectile can hit. */
export type ProjectileTarget = { id: number; circles: readonly Circle[] };

export type ProjectileOutcome = { reason: ProjectileRemoval; targetId?: number } | null;

type Pose = { x: number; y: number; heading: number };

/**
 * Projectiles of one shot. The front gun fires along the heading from the bow; broadsides
 * fire perpendicular to the heading, as parallel balls spread along the hull.
 */
export function createShot(
  pose: Pose,
  slot: WeaponSlot,
  weapon: WeaponConfig,
  stepsPerSecond: number,
): Omit<Projectile, 'id' | 'owner' | 'ownerId'>[] {
  const forward = headingVector(pose.heading);
  const right = { x: -forward.y, y: forward.x };
  const direction =
    slot === 'front' ? forward : slot === 'right' ? right : { x: -right.x, y: -right.y };
  const muzzle = {
    x: pose.x + direction.x * weapon.muzzleOffset,
    y: pose.y + direction.y * weapon.muzzleOffset,
  };
  // The parallel balls are spread perpendicular to the firing direction.
  const spread = { x: -direction.y, y: direction.x };
  const lifeTicks = Math.max(1, Math.round((weapon.range / weapon.speed) * stepsPerSecond));

  return Array.from({ length: weapon.count }, (_, index) => {
    const lateral = (index - (weapon.count - 1) / 2) * weapon.spacing;
    return {
      weapon: slot,
      x: muzzle.x + spread.x * lateral,
      y: muzzle.y + spread.y * lateral,
      vx: direction.x * weapon.speed,
      vy: direction.y * weapon.speed,
      radius: weapon.projectileRadius,
      damage: weapon.damage,
      age: 0,
      lifeTicks,
    };
  });
}

/**
 * Moves a projectile one step along a swept segment. The first contact along the segment
 * wins: an island, or the hull of a target ship (ties: islands first, then targets in the
 * given order). Otherwise it is removed when it leaves the arena or reaches its range.
 */
export function moveProjectile(
  projectile: Projectile,
  dt: number,
  obstacles: readonly Aabb[],
  bounds: Aabb,
  targets: readonly ProjectileTarget[],
): ProjectileOutcome {
  const x0 = projectile.x;
  const y0 = projectile.y;
  const x1 = x0 + projectile.vx * dt;
  const y1 = y0 + projectile.vy * dt;

  let hit: number | null = null;
  let targetId: number | undefined;
  for (const obstacle of obstacles) {
    const entry = segmentAabbEntry(x0, y0, x1, y1, expandAabb(obstacle, projectile.radius));
    if (entry !== null && (hit === null || entry < hit)) hit = entry;
  }
  for (const target of targets) {
    for (const circle of target.circles) {
      const entry = segmentCircleEntry(x0, y0, x1, y1, {
        x: circle.x,
        y: circle.y,
        radius: circle.radius + projectile.radius,
      });
      if (entry !== null && (hit === null || entry < hit)) {
        hit = entry;
        targetId = target.id;
      }
    }
  }
  if (hit !== null) {
    projectile.x = x0 + (x1 - x0) * hit;
    projectile.y = y0 + (y1 - y0) * hit;
    return targetId === undefined ? { reason: 'island' } : { reason: 'ship', targetId };
  }

  projectile.x = x1;
  projectile.y = y1;
  projectile.age += 1;
  if (!pointInAabb(x1, y1, bounds)) return { reason: 'outOfBounds' };
  if (projectile.age >= projectile.lifeTicks) return { reason: 'expired' };
  return null;
}
