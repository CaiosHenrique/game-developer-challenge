/**
 * Gameplay tuning. Systems read every balance value from here, so rebalancing never
 * requires changing simulation logic. Distances are world units (the arena is 1600x900),
 * times are seconds and angles are radians.
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

export type GameConfig = {
  simulation: {
    /** Fixed simulation step. */
    stepSeconds: number;
    /** Longest frame delta fed to the simulation, so a stalled tab cannot cause a burst of steps. */
    maxFrameSeconds: number;
  };
  player: {
    movement: ShipMovement;
    hull: ShipHull;
  };
};

export const DEFAULT_GAME_CONFIG: GameConfig = {
  simulation: {
    stepSeconds: 1 / 60,
    maxFrameSeconds: 0.25,
  },
  player: {
    movement: { maxSpeed: 170, acceleration: 220, deceleration: 160, turnRate: 2.4 },
    hull: { radius: 24, offset: 30 },
  },
};
