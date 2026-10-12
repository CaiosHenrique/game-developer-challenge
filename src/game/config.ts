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

export type EnemyConfig = {
  movement: ShipMovement;
  hull: ShipHull;
  maxHp: number;
};

export type GameConfig = {
  match: {
    /** Active play time of a match (the Options screen will expose it, 60 to 180 s). */
    durationSeconds: number;
  };
  simulation: {
    /** Fixed simulation rate. */
    stepsPerSecond: number;
    /** Longest frame delta fed to the simulation, so a stalled tab cannot cause a burst of steps. */
    maxFrameSeconds: number;
  };
  player: {
    movement: ShipMovement;
    hull: ShipHull;
    maxHp: number;
  };
  enemies: {
    chaser: EnemyConfig & {
      /** Damage dealt to the player when the chaser rams it (it is destroyed by the impact). */
      impactDamage: number;
    };
    shooter: EnemyConfig & {
      /** It stops approaching once the player is this close. */
      preferredRange: number;
      /** It fires only while the player is within this distance... */
      attackRange: number;
      /** ...and within this angle (radians) of its bow. */
      fireCone: number;
      weapon: WeaponConfig;
    };
    ai: {
      /** Length of the two obstacle-detection rays cast ahead of an enemy. */
      feelerLength: number;
      /** Angle of each ray from the bow (radians). */
      feelerAngle: number;
      /** An enemy that barely moves while sailing for this long is considered stuck... */
      stuckSeconds: number;
      /** ...where "barely" is less than this fraction of its top speed. */
      stuckSpeedRatio: number;
      /** A stuck enemy turns away to one fixed side for this long. */
      unstuckSeconds: number;
    };
  };
  spawn: {
    /** Time between two scheduled spawns (the Options screen will expose it). */
    intervalSeconds: number;
    /** Time before the first scheduled spawn. */
    firstDelaySeconds: number;
    /** A spawn point closer than this to the player is not used. */
    minDistanceFromPlayer: number;
    /** A scheduled spawn is skipped while this many enemies are alive. */
    maxAlive: number;
    /** Relative odds of each enemy kind once the opening kinds have spawned. */
    weights: Record<'chaser' | 'shooter', number>;
    /** Kinds of the first spawns, in order, so every match meets both enemy types. */
    openingKinds: readonly ('chaser' | 'shooter')[];
  };
  weapons: {
    front: WeaponConfig;
    /** Used by both the left and the right broadside (each with its own cooldown). */
    side: WeaponConfig;
  };
};

export const DEFAULT_GAME_CONFIG: GameConfig = {
  match: {
    durationSeconds: 120,
  },
  simulation: {
    stepsPerSecond: 60,
    maxFrameSeconds: 0.25,
  },
  player: {
    movement: { maxSpeed: 170, acceleration: 220, deceleration: 160, turnRate: 2.4 },
    hull: { radius: 24, offset: 30 },
    maxHp: 100,
  },
  enemies: {
    chaser: {
      movement: { maxSpeed: 130, acceleration: 160, deceleration: 120, turnRate: 1.8 },
      hull: { radius: 24, offset: 30 },
      maxHp: 40,
      impactDamage: 20,
    },
    shooter: {
      movement: { maxSpeed: 110, acceleration: 120, deceleration: 120, turnRate: 1.5 },
      hull: { radius: 24, offset: 30 },
      maxHp: 60,
      preferredRange: 300,
      attackRange: 380,
      fireCone: (15 * Math.PI) / 180,
      weapon: {
        damage: 15,
        speed: 360,
        range: 420,
        cooldown: 1.8,
        projectileRadius: 5,
        count: 1,
        spacing: 0,
        muzzleOffset: 60,
      },
    },
    ai: {
      feelerLength: 130,
      feelerAngle: 0.45,
      stuckSeconds: 1,
      stuckSpeedRatio: 0.1,
      unstuckSeconds: 0.8,
    },
  },
  spawn: {
    intervalSeconds: 4,
    firstDelaySeconds: 2,
    minDistanceFromPlayer: 450,
    maxAlive: 8,
    weights: { chaser: 1, shooter: 1 },
    openingKinds: ['chaser', 'shooter'],
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
