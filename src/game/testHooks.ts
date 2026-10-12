import type { Ship } from './sim/simulation.ts';
import type { Aabb, Circle } from './sim/geometry.ts';

export type GameStateSnapshot = {
  elapsed: number;
  player: Ship & { hull: Circle[] };
  islands: Aabb[];
  arena: Aabb;
};

/**
 * Test instrumentation, compiled only into the e2e build (`vite build --mode e2e`).
 * It observes state and drives the clock; gameplay still runs through real inputs and rules.
 */
export type PirateTestApi = {
  getState(): GameStateSnapshot;
  /** Stops the real-time clock: the simulation only advances through `advance()`. */
  setManualClock(enabled: boolean): void;
  /** Advances the simulation by whole fixed steps covering `ms` milliseconds. */
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
