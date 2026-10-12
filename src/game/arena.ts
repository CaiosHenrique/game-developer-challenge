import type { Aabb } from './sim/geometry.ts';

/** Logical arena size. The canvas is letterboxed to keep this aspect ratio on any screen. */
export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 900;

export const ARENA_BOUNDS: Aabb = { minX: 0, minY: 0, maxX: WORLD_WIDTH, maxY: WORLD_HEIGHT };

export type IslandKind = 'sand' | 'grass';

export type Island = {
  kind: IslandKind;
  /** Center position in world coordinates. */
  x: number;
  y: number;
};

/** Island texture frames in the tiles spritesheet. */
export const ISLAND_FRAMES: Record<IslandKind, string> = {
  sand: 'island_sand',
  grass: 'island_grass',
};

/** Rendered size of each island texture. */
const ISLAND_SIZES: Record<IslandKind, number> = { sand: 192, grass: 256 };

/** The island art has soft, transparent edges; the collider is inset to match the visible shore. */
const ISLAND_COLLIDER_INSET = 10;

export const ISLANDS: readonly Island[] = [
  { kind: 'grass', x: 430, y: 300 },
  { kind: 'sand', x: 1230, y: 230 },
  { kind: 'sand', x: 1180, y: 660 },
];

/** Islands block ships (and, later, projectiles). */
export const ISLAND_COLLIDERS: readonly Aabb[] = ISLANDS.map((island) => {
  const half = ISLAND_SIZES[island.kind] / 2 - ISLAND_COLLIDER_INSET;
  return {
    minX: island.x - half,
    minY: island.y - half,
    maxX: island.x + half,
    maxY: island.y + half,
  };
});

export const PLAYER_START = { x: 800, y: 450, heading: 0 };

/**
 * Candidate enemy spawn points, near the arena edges and clear of every island for a hull
 * in any orientation (validated by a unit test).
 */
export const SPAWN_POINTS: readonly { x: number; y: number }[] = [
  ...[150, 500, 800, 1100, 1450].flatMap((x) => [
    { x, y: 70 },
    { x, y: 830 },
  ]),
  ...[250, 450, 650].flatMap((y) => [
    { x: 70, y },
    { x: 1530, y },
  ]),
];
