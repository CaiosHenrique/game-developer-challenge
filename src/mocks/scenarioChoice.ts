import { DEFAULT_SCENARIO, isScenarioId, type ScenarioId } from './scenarios.ts';

/** Where the chosen network scenario is kept between page loads. */
export const SCENARIO_KEY = 'pirate-battle.mockScenario.v1';

/** Seed of the scenario latencies when `?apiSeed=` is not given. */
export const DEFAULT_API_SEED = 1;

/** The saved scenario, or null (none, unreadable or unknown). */
export function savedScenario(storage: Storage | null): ScenarioId | null {
  try {
    const saved = storage?.getItem(SCENARIO_KEY);
    return isScenarioId(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Keeps the scenario for the next page loads. Returns false when storage refused it. */
export function saveScenario(id: ScenarioId, storage: Storage | null): boolean {
  try {
    storage?.setItem(SCENARIO_KEY, id);
    return storage !== null;
  } catch {
    return false;
  }
}

/**
 * The scenario a page load starts with:
 * 1. a valid `?api=<scenario>` wins, and is saved for the next loads;
 * 2. otherwise the saved scenario;
 * 3. otherwise `normal`.
 * An unknown `?api=` value is ignored (fallback to 2, then 3): it never breaks the app.
 */
export function initialScenario(search: string, storage: Storage | null): ScenarioId {
  const requested = new URLSearchParams(search).get('api');
  if (isScenarioId(requested)) {
    saveScenario(requested, storage);
    return requested;
  }
  return savedScenario(storage) ?? DEFAULT_SCENARIO;
}

/** `?apiSeed=<uint32>` fixes the sequence of scenario latencies; invalid values are ignored. */
export function apiSeedFromQuery(search: string): number {
  const value = new URLSearchParams(search).get('apiSeed');
  return value !== null && /^\d+$/.test(value) ? Number(value) >>> 0 : DEFAULT_API_SEED;
}
