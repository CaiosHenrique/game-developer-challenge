import type { WeaponConfig } from '../config.ts';
import { expandAabb, headingVector, pointInAabb, segmentAabbEntry, type Aabb } from './geometry.ts';

export type WeaponSlot = 'front' | 'left' | 'right';

export const WEAPON_SLOTS: readonly WeaponSlot[] = ['front', 'left', 'right'];

export type Faction = 'player' | 'enemy';

export type Projectile = {
  id: number;
  owner: Faction;
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

export type ProjectileRemoval = 'island' | 'outOfBounds' | 'expired';

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
): Omit<Projectile, 'id' | 'owner'>[] {
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
 * Moves a projectile one step. Returns why it must be removed, if it hit an island along
 * the swept segment, left the arena or reached the end of its range.
 */
export function moveProjectile(
  projectile: Projectile,
  dt: number,
  obstacles: readonly Aabb[],
  bounds: Aabb,
): ProjectileRemoval | null {
  const x0 = projectile.x;
  const y0 = projectile.y;
  const x1 = x0 + projectile.vx * dt;
  const y1 = y0 + projectile.vy * dt;

  let hit: number | null = null;
  for (const obstacle of obstacles) {
    const entry = segmentAabbEntry(x0, y0, x1, y1, expandAabb(obstacle, projectile.radius));
    if (entry !== null && (hit === null || entry < hit)) hit = entry;
  }
  if (hit !== null) {
    projectile.x = x0 + (x1 - x0) * hit;
    projectile.y = y0 + (y1 - y0) * hit;
    return 'island';
  }

  projectile.x = x1;
  projectile.y = y1;
  projectile.age += 1;
  if (!pointInAabb(x1, y1, bounds)) return 'outOfBounds';
  if (projectile.age >= projectile.lifeTicks) return 'expired';
  return null;
}
