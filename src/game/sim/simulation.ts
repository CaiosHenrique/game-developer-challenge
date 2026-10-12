import { ARENA_BOUNDS, ISLAND_COLLIDERS, PLAYER_START } from '../arena.ts';
import { secondsToTicks, type GameConfig, type ShipHull, type ShipMovement } from '../config.ts';
import {
  circleAabbPush,
  circleBoundsPush,
  headingVector,
  type Aabb,
  type Circle,
  type Vec,
} from './geometry.ts';
import {
  createShot,
  moveProjectile,
  WEAPON_SLOTS,
  type Projectile,
  type ProjectileRemoval,
  type WeaponSlot,
} from './weapons.ts';

/** Player commands sampled once per simulation step. */
export type InputState = {
  forward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  fireFront: boolean;
  fireLeft: boolean;
  fireRight: boolean;
};

const FIRE_INPUT: Record<WeaponSlot, keyof InputState> = {
  front: 'fireFront',
  left: 'fireLeft',
  right: 'fireRight',
};

/** Facts produced by a step, consumed by the renderer for visual effects only. */
export type SimEvent =
  | { type: 'shot'; weapon: WeaponSlot; muzzles: { x: number; y: number }[]; heading: number }
  | { type: 'projectileRemoved'; id: number; x: number; y: number; reason: ProjectileRemoval };

export type Ship = {
  x: number;
  y: number;
  /** Radians; 0 points up, grows clockwise. */
  heading: number;
  /** Speed along the heading (ships only sail forward). */
  speed: number;
};

/** Collision passes per step; a second pass settles contacts against two obstacles. */
const COLLISION_PASSES = 2;

/** The two circles that approximate a ship hull (bow, stern). */
export function hullCircles(ship: Ship, hull: ShipHull): [Circle, Circle] {
  const forward = headingVector(ship.heading);
  return [
    {
      x: ship.x + forward.x * hull.offset,
      y: ship.y + forward.y * hull.offset,
      radius: hull.radius,
    },
    {
      x: ship.x - forward.x * hull.offset,
      y: ship.y - forward.y * hull.offset,
      radius: hull.radius,
    },
  ];
}

function steerShip(ship: Ship, movement: ShipMovement, input: InputState, dt: number): void {
  const turn = (input.turnRight ? 1 : 0) - (input.turnLeft ? 1 : 0);
  ship.heading += turn * movement.turnRate * dt;

  ship.speed = input.forward
    ? Math.min(movement.maxSpeed, ship.speed + movement.acceleration * dt)
    : Math.max(0, ship.speed - movement.deceleration * dt);

  const forward = headingVector(ship.heading);
  ship.x += forward.x * ship.speed * dt;
  ship.y += forward.y * ship.speed * dt;
}

/**
 * Pushes the hull out of islands and back inside the arena. A ship sailing into a contact
 * is slowed according to the impact angle: head-on it stops, at a glancing angle it keeps
 * sliding along the shore.
 */
function resolveShipCollisions(
  ship: Ship,
  hull: ShipHull,
  maxSpeed: number,
  obstacles: readonly Aabb[],
  bounds: Aabb,
): void {
  for (let pass = 0; pass < COLLISION_PASSES; pass += 1) {
    for (const index of [0, 1] as const) {
      // Circles are recomputed after every push, since moving the ship moves both of them.
      for (const obstacle of obstacles) {
        const push = circleAabbPush(hullCircles(ship, hull)[index], obstacle);
        if (push) applyContact(ship, push, maxSpeed);
      }
      const boundsPush = circleBoundsPush(hullCircles(ship, hull)[index], bounds);
      if (boundsPush.x !== 0 || boundsPush.y !== 0) applyContact(ship, boundsPush, maxSpeed);
    }
  }
}

function applyContact(ship: Ship, push: Vec, maxSpeed: number): void {
  ship.x += push.x;
  ship.y += push.y;

  const length = Math.hypot(push.x, push.y);
  if (length === 0) return;
  const forward = headingVector(ship.heading);
  const intoContact = -(forward.x * push.x + forward.y * push.y) / length;
  // A speed cap (not a per-step factor), so the result does not depend on the step rate.
  if (intoContact > 0) ship.speed = Math.min(ship.speed, maxSpeed * (1 - intoContact));
}

/** Deterministic game simulation. It has no rendering or DOM dependencies. */
export class Simulation {
  readonly player: Ship;
  readonly projectiles: Projectile[] = [];
  /** Completed simulation steps. All game timing is expressed in whole ticks. */
  tick = 0;
  /** Tick from which each weapon may fire again. */
  readonly weaponReadyAt: Record<WeaponSlot, number> = { front: 0, left: 0, right: 0 };
  readonly shotsFired: Record<WeaponSlot, number> = { front: 0, left: 0, right: 0 };
  readonly projectilesRemoved: Record<ProjectileRemoval, number> = {
    island: 0,
    outOfBounds: 0,
    expired: 0,
  };
  private nextProjectileId = 1;
  private events: SimEvent[] = [];
  private readonly dt: number;

  constructor(readonly config: GameConfig) {
    this.player = { x: PLAYER_START.x, y: PLAYER_START.y, heading: PLAYER_START.heading, speed: 0 };
    this.dt = 1 / config.simulation.stepsPerSecond;
  }

  /** Simulated seconds since the match started. */
  get elapsed(): number {
    return this.tick / this.config.simulation.stepsPerSecond;
  }

  step(input: InputState): void {
    const { movement, hull } = this.config.player;
    steerShip(this.player, movement, input, this.dt);
    resolveShipCollisions(this.player, hull, movement.maxSpeed, ISLAND_COLLIDERS, ARENA_BOUNDS);
    this.updateProjectiles();
    this.fireWeapons(input);
    this.tick += 1;
  }

  /** Returns and clears the events produced since the last call. */
  drainEvents(): SimEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  private updateProjectiles(): void {
    let kept = 0;
    for (const projectile of this.projectiles) {
      const removal = moveProjectile(projectile, this.dt, ISLAND_COLLIDERS, ARENA_BOUNDS);
      if (removal) {
        this.projectilesRemoved[removal] += 1;
        this.events.push({
          type: 'projectileRemoved',
          id: projectile.id,
          x: projectile.x,
          y: projectile.y,
          reason: removal,
        });
      } else {
        this.projectiles[kept++] = projectile;
      }
    }
    this.projectiles.length = kept;
  }

  private fireWeapons(input: InputState): void {
    const { stepsPerSecond } = this.config.simulation;
    for (const slot of WEAPON_SLOTS) {
      if (!input[FIRE_INPUT[slot]] || this.tick < this.weaponReadyAt[slot]) continue;

      const weapon = slot === 'front' ? this.config.weapons.front : this.config.weapons.side;
      this.weaponReadyAt[slot] = this.tick + secondsToTicks(weapon.cooldown, stepsPerSecond);
      this.shotsFired[slot] += 1;

      const shot = createShot(this.player, slot, weapon, stepsPerSecond);
      for (const projectile of shot) {
        this.projectiles.push({ ...projectile, id: this.nextProjectileId++, owner: 'player' });
      }
      this.events.push({
        type: 'shot',
        weapon: slot,
        muzzles: shot.map(({ x, y }) => ({ x, y })),
        heading: this.player.heading,
      });
    }
  }
}
