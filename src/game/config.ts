/**
 * Gameplay tuning. Systems read every balance value from here, so rebalancing never
 * requires changing simulation logic. Distances are world units (the arena is 1600x900),
 * times are seconds and angles are radians. Durations are converted to whole simulation
 * ticks (rounded), so timing is exact and deterministic.
 */
export type ShipHull = {
  /** Radius of the two circles that approximate the hull. */
  radius: number;
  /** Distance of each circle from the ship center, along the heading. */
  offset: number;
};

export type ShipMovement = {
  maxSpeed: number;
  acceleration: number;
  /** Speed lost per second when not accelerating. */
  deceleration: number;
  turnRate: number;
};

export type WeaponConfig = {
  damage: number;
  /** Projectile speed. */
  speed: number;
  /** Distance a projectile travels before it expires. */
  range: number;
  /** Minimum time between two shots of this weapon. */
  cooldown: number;
  projectileRadius: number;
  /** Projectiles per shot. */
  count: number;
  /** Distance between parallel projectiles of one shot, along the hull. */
  spacing: number;
  /** Distance from the ship center to the muzzle (bow for the front gun, beam for broadsides). */
  muzzleOffset: number;
};

export type GameConfig = {
  simulation: {
    /** Fixed simulation rate. */
    stepsPerSecond: number;
    /** Longest frame delta fed to the simulation, so a stalled tab cannot cause a burst of steps. */
    maxFrameSeconds: number;
  };
  player: {
    movement: ShipMovement;
    hull: ShipHull;
  };
  weapons: {
    front: WeaponConfig;
    /** Used by both the left and the right broadside (each with its own cooldown). */
    side: WeaponConfig;
  };
};

export const DEFAULT_GAME_CONFIG: GameConfig = {
  simulation: {
    stepsPerSecond: 60,
    maxFrameSeconds: 0.25,
  },
  player: {
    movement: { maxSpeed: 170, acceleration: 220, deceleration: 160, turnRate: 2.4 },
    hull: { radius: 24, offset: 30 },
  },
  weapons: {
    front: {
      damage: 25,
      speed: 420,
      range: 520,
      cooldown: 0.6,
      projectileRadius: 5,
      count: 1,
      spacing: 0,
      muzzleOffset: 60,
    },
    side: {
      damage: 20,
      speed: 380,
      range: 380,
      cooldown: 1.5,
      projectileRadius: 5,
      count: 3,
      spacing: 28,
      muzzleOffset: 30,
    },
  },
};

/** Converts a duration to whole simulation ticks (at least one). */
export function secondsToTicks(seconds: number, stepsPerSecond: number): number {
  return Math.max(1, Math.round(seconds * stepsPerSecond));
}
