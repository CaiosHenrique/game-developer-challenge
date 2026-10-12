export type Vec = { x: number; y: number };

export type Circle = { x: number; y: number; radius: number };

export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

/** Unit vector of a heading. Heading 0 points up (-Y) and grows clockwise. */
export function headingVector(heading: number): Vec {
  return { x: Math.sin(heading), y: -Math.cos(heading) };
}

/**
 * Minimal translation that moves a circle out of a box, or null when they don't overlap.
 * A circle whose center is inside the box is pushed out through the nearest face.
 */
export function circleAabbPush(circle: Circle, box: Aabb): Vec | null {
  const closestX = Math.min(Math.max(circle.x, box.minX), box.maxX);
  const closestY = Math.min(Math.max(circle.y, box.minY), box.maxY);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  const distanceSq = dx * dx + dy * dy;

  if (distanceSq > 0) {
    if (distanceSq >= circle.radius * circle.radius) return null;
    const distance = Math.sqrt(distanceSq);
    const depth = circle.radius - distance;
    return { x: (dx / distance) * depth, y: (dy / distance) * depth };
  }

  const toLeft = circle.x - box.minX;
  const toRight = box.maxX - circle.x;
  const toTop = circle.y - box.minY;
  const toBottom = box.maxY - circle.y;
  const nearest = Math.min(toLeft, toRight, toTop, toBottom);
  if (nearest === toLeft) return { x: -(toLeft + circle.radius), y: 0 };
  if (nearest === toRight) return { x: toRight + circle.radius, y: 0 };
  if (nearest === toTop) return { x: 0, y: -(toTop + circle.radius) };
  return { x: 0, y: toBottom + circle.radius };
}

/** Translation that keeps a circle inside the bounds (zero vector when already inside). */
export function circleBoundsPush(circle: Circle, bounds: Aabb): Vec {
  let x = 0;
  let y = 0;
  if (circle.x - circle.radius < bounds.minX) x = bounds.minX - (circle.x - circle.radius);
  else if (circle.x + circle.radius > bounds.maxX) x = bounds.maxX - (circle.x + circle.radius);
  if (circle.y - circle.radius < bounds.minY) y = bounds.minY - (circle.y - circle.radius);
  else if (circle.y + circle.radius > bounds.maxY) y = bounds.maxY - (circle.y + circle.radius);
  return { x, y };
}
