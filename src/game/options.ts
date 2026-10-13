import { DEFAULT_GAME_CONFIG, type GameConfig } from './config.ts';

/** Player-adjustable settings (the Options screen). */
export type GameOptions = {
  /** Active play time of a match, in whole seconds. */
  sessionSeconds: number;
  /** Time between scheduled enemy spawns, in seconds (half-second steps). */
  spawnIntervalSeconds: number;
};

/** Documented limits of each option. */
export const OPTION_LIMITS = {
  sessionSeconds: { min: 60, max: 180, step: 1 },
  spawnIntervalSeconds: { min: 1, max: 10, step: 0.5 },
} as const;

export const DEFAULT_OPTIONS: GameOptions = {
  sessionSeconds: DEFAULT_GAME_CONFIG.match.durationSeconds,
  spawnIntervalSeconds: DEFAULT_GAME_CONFIG.spawn.intervalSeconds,
};

export type OptionErrors = Partial<Record<keyof GameOptions, string>>;

function isOnStep(value: number, step: number): boolean {
  return Number.isInteger(Math.round((value / step) * 1e9) / 1e9);
}

/** Validation messages per field; an empty object means the options are valid. */
export function validateOptions(options: Record<keyof GameOptions, unknown>): OptionErrors {
  const errors: OptionErrors = {};
  const session = options.sessionSeconds;
  const { sessionSeconds: s, spawnIntervalSeconds: i } = OPTION_LIMITS;
  if (typeof session !== 'number' || !Number.isFinite(session)) {
    errors.sessionSeconds = 'Enter the game session time in seconds.';
  } else if (!Number.isInteger(session) || session < s.min || session > s.max) {
    errors.sessionSeconds = `Game session time must be a whole number from ${s.min} to ${s.max} seconds.`;
  }
  const interval = options.spawnIntervalSeconds;
  if (typeof interval !== 'number' || !Number.isFinite(interval)) {
    errors.spawnIntervalSeconds = 'Enter the enemy spawn time in seconds.';
  } else if (interval < i.min || interval > i.max || !isOnStep(interval, i.step)) {
    errors.spawnIntervalSeconds = `Enemy spawn time must be from ${i.min} to ${i.max} seconds, in steps of ${i.step}.`;
  }
  return errors;
}

/**
 * Brings untrusted values (e.g. read from storage) back to valid options: each invalid or
 * missing field falls back to its default.
 */
export function sanitizeOptions(value: unknown): GameOptions {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<
    keyof GameOptions,
    unknown
  >;
  const errors = validateOptions(source);
  return {
    sessionSeconds: errors.sessionSeconds
      ? DEFAULT_OPTIONS.sessionSeconds
      : (source.sessionSeconds as number),
    spawnIntervalSeconds: errors.spawnIntervalSeconds
      ? DEFAULT_OPTIONS.spawnIntervalSeconds
      : (source.spawnIntervalSeconds as number),
  };
}

/** A fresh game configuration for one match, built from valid options. */
export function configFromOptions(options: GameOptions): GameConfig {
  const valid = sanitizeOptions(options);
  const config = structuredClone(DEFAULT_GAME_CONFIG);
  config.match.durationSeconds = valid.sessionSeconds;
  config.spawn.intervalSeconds = valid.spawnIntervalSeconds;
  return config;
}
