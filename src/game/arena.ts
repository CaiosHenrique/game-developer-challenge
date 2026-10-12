/** Logical arena size. The canvas is letterboxed to keep this aspect ratio on any screen. */
export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 900;

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

export const ISLANDS: readonly Island[] = [
  { kind: 'grass', x: 430, y: 300 },
  { kind: 'sand', x: 1230, y: 230 },
  { kind: 'sand', x: 1180, y: 660 },
];

export const PLAYER_START = { x: 800, y: 450 };
