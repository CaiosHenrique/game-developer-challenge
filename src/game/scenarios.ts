import type { SimulationOptions } from './sim/simulation.ts';

/**
 * Fixed starting situations for end-to-end tests, selected with `?scenario=<name>`.
 * They only exist in the e2e build: in any other build `scenarioFromQuery` returns
 * undefined and this table is tree-shaken away. Gameplay still runs through real input.
 */
const E2E_SCENARIOS: Record<string, SimulationOptions> = {
  /** A chaser straight ahead of the player, in its line of fire. */
  'chaser-ahead': {
    playerStart: { x: 800, y: 700, heading: 0 },
    enemies: [{ kind: 'chaser', x: 800, y: 200, heading: Math.PI }],
  },
  /** A chaser that has to turn towards the player before ramming it. */
  'chaser-flank': {
    playerStart: { x: 800, y: 450, heading: 0 },
    enemies: [{ kind: 'chaser', x: 300, y: 750, heading: 0 }],
  },
  /** A chaser with the grass island between it and the player, head-on. */
  'chaser-behind-island': {
    playerStart: { x: 800, y: 300, heading: 0 },
    enemies: [{ kind: 'chaser', x: 100, y: 300, heading: Math.PI / 2 }],
  },
  /** A shooter far ahead of the player, outside its attack range. */
  'shooter-far': {
    playerStart: { x: 800, y: 800, heading: 0 },
    enemies: [{ kind: 'shooter', x: 800, y: 100, heading: Math.PI }],
  },
  /** Both enemy types at once, for visual checks. */
  skirmish: {
    playerStart: { x: 800, y: 450, heading: 0 },
    enemies: [
      { kind: 'chaser', x: 150, y: 800, heading: 0 },
      { kind: 'shooter', x: 1450, y: 100, heading: Math.PI },
      { kind: 'chaser', x: 1450, y: 820, heading: 0 },
      { kind: 'shooter', x: 150, y: 80, heading: Math.PI },
    ],
  },
};

export function scenarioFromQuery(search: string): SimulationOptions | undefined {
  return import.meta.env.MODE === 'e2e'
    ? E2E_SCENARIOS[new URLSearchParams(search).get('scenario') ?? '']
    : undefined;
}
