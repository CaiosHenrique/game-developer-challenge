import { z } from 'zod';
import { sanitizeOptions, type GameOptions } from '../game/options.ts';
import { randomId } from '../ids.ts';

/** Versioned keys: a change of shape gets a new key instead of misreading old data. */
export const STORAGE_KEYS = {
  options: 'pirate-battle.options.v1',
  lastResult: 'pirate-battle.lastResult.v1',
  player: 'pirate-battle.player.v1',
} as const;

/** The result of a completed match, as stored on this device. */
export type StoredResult = {
  matchId: string;
  /** ISO timestamp, set once when the match ended. */
  finishedAt: string;
  score: number;
  timePlayedSeconds: number;
  reason: 'time' | 'death';
  options: GameOptions;
};

const storedResultSchema = z.object({
  matchId: z.string().min(1),
  finishedAt: z.string().min(1),
  score: z.number().int().nonnegative(),
  timePlayedSeconds: z.number().nonnegative(),
  reason: z.enum(['time', 'death']),
  options: z.object({ sessionSeconds: z.number(), spawnIntervalSeconds: z.number() }),
});

/** The browser's storage, or null when it is unavailable (e.g. blocked by privacy settings). */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJson(storage: Storage | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function writeJson(storage: Storage | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Saved options; missing, unreadable or invalid values fall back to the defaults. */
export function loadOptions(storage = browserStorage()): GameOptions {
  return sanitizeOptions(readJson(storage, STORAGE_KEYS.options));
}

/** Returns whether the options were written to storage. */
export function saveOptions(options: GameOptions, storage = browserStorage()): boolean {
  return writeJson(storage, STORAGE_KEYS.options, sanitizeOptions(options));
}

/** The last completed match stored on this device, or null (none, unreadable or invalid). */
export function loadLastResult(storage = browserStorage()): StoredResult | null {
  const parsed = storedResultSchema.safeParse(readJson(storage, STORAGE_KEYS.lastResult));
  return parsed.success ? { ...parsed.data, options: sanitizeOptions(parsed.data.options) } : null;
}

export type SaveOutcome = 'saved' | 'duplicate' | 'failed';

/**
 * Stores a completed match. Idempotent: a result whose matchId is already stored is not
 * written again. Returns 'failed' when the storage is unavailable or refuses the write.
 */
export function saveLastResult(result: StoredResult, storage = browserStorage()): SaveOutcome {
  if (loadLastResult(storage)?.matchId === result.matchId) return 'duplicate';
  return writeJson(storage, STORAGE_KEYS.lastResult, result) ? 'saved' : 'failed';
}

/**
 * The player of this device. There is no authentication: this is a local, simulated
 * identity, generated once and kept in storage.
 */
export type Player = { playerId: string; playerName: string };

const playerSchema = z.object({
  playerId: z.string().min(1).max(64),
  playerName: z.string().min(1).max(40),
});

/** A readable name derived from the id, e.g. "Captain 4F2A". */
export function playerNameFor(playerId: string): string {
  const tag = playerId
    .replace(/[^0-9a-z]/gi, '')
    .slice(0, 4)
    .toUpperCase();
  return `Captain ${tag || 'X'}`;
}

/**
 * The stored player, or a new one stored now. When storage is unavailable the new identity
 * only lasts for this page load (`persisted: false`).
 */
export function loadOrCreatePlayer(
  storage = browserStorage(),
  newId: () => string = randomId,
): Player & { persisted: boolean } {
  const stored = playerSchema.safeParse(readJson(storage, STORAGE_KEYS.player));
  if (stored.success) return { ...stored.data, persisted: true };
  const playerId = newId();
  const player = { playerId, playerName: playerNameFor(playerId) };
  return { ...player, persisted: writeJson(storage, STORAGE_KEYS.player, player) };
}
