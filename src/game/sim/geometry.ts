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

export function expandAabb(box: Aabb, amount: number): Aabb {
  return {
    minX: box.minX - amount,
    minY: box.minY - amount,
    maxX: box.maxX + amount,
    maxY: box.maxY + amount,
  };
}

export function pointInAabb(x: number, y: number, box: Aabb): boolean {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

/**
 * Where the segment from (x0, y0) to (x1, y1) first enters the box, as a fraction of the
 * segment in [0, 1] (0 when it starts inside), or null when it never touches the box.
 * Testing the whole segment (slab method) means fast objects cannot skip over obstacles
 * between two simulation steps.
 */
export function segmentAabbEntry(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  box: Aabb,
): number | null {
  let tMin = 0;
  let tMax = 1;
  const axes: [number, number, number, number][] = [
    [x0, x1 - x0, box.minX, box.maxX],
    [y0, y1 - y0, box.minY, box.maxY],
  ];
  for (const [start, delta, min, max] of axes) {
    if (delta === 0) {
      if (start < min || start > max) return null;
      continue;
    }
    let tNear = (min - start) / delta;
    let tFar = (max - start) / delta;
    if (tNear > tFar) [tNear, tFar] = [tFar, tNear];
    tMin = Math.max(tMin, tNear);
    tMax = Math.min(tMax, tFar);
    if (tMin > tMax) return null;
  }
  return tMin;
}

/**
 * Where the segment from (x0, y0) to (x1, y1) first touches the circle, as a fraction of
 * the segment in [0, 1] (0 when it starts inside), or null when it misses.
 */
export function segmentCircleEntry(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  circle: Circle,
): number | null {
  const fx = x0 - circle.x;
  const fy = y0 - circle.y;
  const c = fx * fx + fy * fy - circle.radius * circle.radius;
  if (c <= 0) return 0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
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
