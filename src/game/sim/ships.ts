import type { ShipHull, ShipMovement } from '../config.ts';
import {
  circleAabbPush,
  circleBoundsPush,
  headingVector,
  type Aabb,
  type Circle,
  type Vec,
} from './geometry.ts';

export type Ship = {
  x: number;
  y: number;
  /** Radians; 0 points up, grows clockwise. */
  heading: number;
  /** Speed along the heading (ships only sail forward). */
  speed: number;
};

/** What a ship is told to do in one step, by the player's input or by the AI. */
export type ShipControls = {
  throttle: boolean;
  /** -1 turns left (counter-clockwise) at full rate, 1 turns right; values in between are partial. */
  turn: number;
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

export function steerShip(
  ship: Ship,
  movement: ShipMovement,
  controls: ShipControls,
  dt: number,
): void {
  const turn = Math.max(-1, Math.min(1, controls.turn));
  ship.heading += turn * movement.turnRate * dt;

  ship.speed = controls.throttle
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
export function resolveShipCollisions(
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

/** True when any circle of one hull overlaps any circle of the other. */
export function hullsOverlap(a: Ship, aHull: ShipHull, b: Ship, bHull: ShipHull): boolean {
  for (const ca of hullCircles(a, aHull)) {
    for (const cb of hullCircles(b, bHull)) {
      if (Math.hypot(cb.x - ca.x, cb.y - ca.y) < ca.radius + cb.radius) return true;
    }
  }
  return false;
}

/** Pushes two overlapping hulls apart, each ship moving half of the overlap. */
export function separateShips(a: Ship, aHull: ShipHull, b: Ship, bHull: ShipHull): void {
  for (const index of [0, 1] as const) {
    for (const otherIndex of [0, 1] as const) {
      const ca = hullCircles(a, aHull)[index];
      const cb = hullCircles(b, bHull)[otherIndex];
      const dx = cb.x - ca.x;
      const dy = cb.y - ca.y;
      const distance = Math.hypot(dx, dy);
      const overlap = ca.radius + cb.radius - distance;
      if (overlap <= 0) continue;
      // Coincident centers have no direction; separate them along x.
      const nx = distance > 0 ? dx / distance : 1;
      const ny = distance > 0 ? dy / distance : 0;
      a.x -= (nx * overlap) / 2;
      a.y -= (ny * overlap) / 2;
      b.x += (nx * overlap) / 2;
      b.y += (ny * overlap) / 2;
    }
  }
}
