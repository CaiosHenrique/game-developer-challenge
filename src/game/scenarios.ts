import { DEFAULT_GAME_CONFIG } from './config.ts';
import type { SimulationOptions } from './sim/simulation.ts';

/**
 * Fixed starting situations for end-to-end tests, selected with `?scenario=<name>`.
 * They only exist in the e2e build: in any other build `testOptionsFromQuery` returns
 * undefined and this table is tree-shaken away. Gameplay still runs through real input.
 */
const E2E_SCENARIOS: Record<string, SimulationOptions> = {
  /** The player alone: no enemies and no spawner (movement and weapon tests). */
  'open-sea': { spawner: false },
  /** A chaser straight ahead of the player, in its line of fire. */
  'chaser-ahead': {
    spawner: false,
    playerStart: { x: 800, y: 700, heading: 0 },
    enemies: [{ kind: 'chaser', x: 800, y: 200, heading: Math.PI }],
  },
  /** A chaser that has to turn towards the player before ramming it. */
  'chaser-flank': {
    spawner: false,
    playerStart: { x: 800, y: 450, heading: 0 },
    enemies: [{ kind: 'chaser', x: 300, y: 750, heading: 0 }],
  },
  /** A chaser with the grass island between it and the player, head-on. */
  'chaser-behind-island': {
    spawner: false,
    playerStart: { x: 800, y: 300, heading: 0 },
    enemies: [{ kind: 'chaser', x: 100, y: 300, heading: Math.PI / 2 }],
  },
  /** A shooter far ahead of the player, outside its attack range. */
  'shooter-far': {
    spawner: false,
    playerStart: { x: 800, y: 800, heading: 0 },
    enemies: [{ kind: 'shooter', x: 800, y: 100, heading: Math.PI }],
  },
  /** The default match (spawner on), with a player that cannot sink: spawner observation. */
  'endless-spawns': { playerHp: 1_000_000 },
  /** A player with one ram's worth of health and a chaser about to ram it. */
  'last-stand': {
    spawner: false,
    playerHp: DEFAULT_GAME_CONFIG.enemies.chaser.impactDamage,
    playerStart: { x: 800, y: 450, heading: 0 },
    enemies: [{ kind: 'chaser', x: 800, y: 250, heading: Math.PI }],
  },
  /** Both enemy types at once, for visual checks. */
  skirmish: {
    spawner: false,
    playerStart: { x: 800, y: 450, heading: 0 },
    enemies: [
      { kind: 'chaser', x: 150, y: 800, heading: 0 },
      { kind: 'shooter', x: 1450, y: 100, heading: Math.PI },
      { kind: 'chaser', x: 1450, y: 820, heading: 0 },
      { kind: 'shooter', x: 150, y: 80, heading: Math.PI },
    ],
  },
};

/** Test-only: `?clock=manual` starts every match on the manual (test-driven) clock. */
export function testManualClockFromQuery(search: string): boolean {
  return import.meta.env.MODE === 'e2e' && new URLSearchParams(search).get('clock') === 'manual';
}

/** Test-only: `?resultDelay=<ms>` overrides the pause before the Result screen. */
export function testResultDelayFromQuery(search: string): number | undefined {
  if (import.meta.env.MODE !== 'e2e') return undefined;
  const value = new URLSearchParams(search).get('resultDelay');
  return value !== null && /^\d+$/.test(value) ? Number(value) : undefined;
}

/** Test-only match options from the URL: `?scenario=<name>` and/or `?seed=<uint32>`. */
export function testOptionsFromQuery(search: string): SimulationOptions | undefined {
  if (import.meta.env.MODE !== 'e2e') return undefined;
  const params = new URLSearchParams(search);
  const scenario = E2E_SCENARIOS[params.get('scenario') ?? ''];
  const seedParam = params.get('seed');
  const seed = seedParam !== null && /^\d+$/.test(seedParam) ? Number(seedParam) >>> 0 : undefined;
  if (!scenario && seed === undefined) return undefined;
  return { ...scenario, ...(seed !== undefined && { seed }) };
}
