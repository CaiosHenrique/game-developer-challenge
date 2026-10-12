import type { RendererStats } from './render/GameRenderer.ts';
import type { Aabb, Circle } from './sim/geometry.ts';
import type { Ship } from './sim/simulation.ts';
import type { Projectile, ProjectileRemoval, WeaponSlot } from './sim/weapons.ts';

export type GameStateSnapshot = {
  tick: number;
  elapsed: number;
  player: Ship & { hull: Circle[] };
  projectiles: Projectile[];
  weaponReadyAt: Record<WeaponSlot, number>;
  shotsFired: Record<WeaponSlot, number>;
  projectilesRemoved: Record<ProjectileRemoval, number>;
  islands: Aabb[];
  arena: Aabb;
  render: RendererStats | null;
};

/**
 * Test instrumentation, compiled only into the e2e build (`vite build --mode e2e`).
 * It observes state and drives the clock; gameplay still runs through real inputs and rules.
 */
export type PirateTestApi = {
  getState(): GameStateSnapshot;
  /** Stops the real-time clock: the simulation only advances through `step`/`advance`. */
  setManualClock(enabled: boolean): void;
  /** Runs exactly `count` simulation steps. */
  step(count: number): void;
  /** Runs the whole number of steps closest to `ms` milliseconds. */
  advance(ms: number): void;
};

declare global {
  interface Window {
    __pirateTest?: PirateTestApi;
  }
}

export const TEST_HOOKS_ENABLED = import.meta.env.MODE === 'e2e';

export function installTestHooks(api: PirateTestApi): () => void {
  if (!TEST_HOOKS_ENABLED) return () => {};
  window.__pirateTest = api;
  return () => {
    if (window.__pirateTest === api) delete window.__pirateTest;
  };
}
