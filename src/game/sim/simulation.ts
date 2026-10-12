import { ARENA_BOUNDS, ISLAND_COLLIDERS, PLAYER_START } from '../arena.ts';
import type { GameConfig, ShipHull, ShipMovement } from '../config.ts';
import {
  circleAabbPush,
  circleBoundsPush,
  headingVector,
  type Aabb,
  type Circle,
  type Vec,
} from './geometry.ts';

/** Player commands sampled once per simulation step. */
export type InputState = {
  forward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
};

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
  /** Simulated seconds since the match started. */
  elapsed = 0;

  constructor(readonly config: GameConfig) {
    this.player = { x: PLAYER_START.x, y: PLAYER_START.y, heading: PLAYER_START.heading, speed: 0 };
  }

  step(dt: number, input: InputState): void {
    const { movement, hull } = this.config.player;
    steerShip(this.player, movement, input, dt);
    resolveShipCollisions(this.player, hull, movement.maxSpeed, ISLAND_COLLIDERS, ARENA_BOUNDS);
    this.elapsed += dt;
  }
}
