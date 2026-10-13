import { z } from 'zod';
import {
  matchRecordSchema,
  type MatchRecord,
  type Page,
  type RankingEntry,
} from '../api/contracts.ts';
import { fixtureRecords } from './fixtures.ts';

/** Where the mock API keeps its records. */
export const MOCK_DB_KEY = 'pirate-battle.mockdb.v1';

/** `local`: kept after a reload. `memory`: storage is unavailable, lost on reload. */
export type MockPersistence = 'local' | 'memory';

const storedDbSchema = z.object({ records: z.array(matchRecordSchema) });

/** Locale-independent order of ids (UTF-16 code units). */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ranking order: higher score, then the earlier match, then the match id. Total and stable. */
export function compareRanking(a: MatchRecord, b: MatchRecord): number {
  return (
    b.score - a.score ||
    Date.parse(a.finishedAt) - Date.parse(b.finishedAt) ||
    compareIds(a.matchId, b.matchId)
  );
}

/** History order: most recent first, then the match id. */
export function compareHistory(a: MatchRecord, b: MatchRecord): number {
  return Date.parse(b.finishedAt) - Date.parse(a.finishedAt) || compareIds(a.matchId, b.matchId);
}

/** One page of an already ordered list. A page past the end is empty, never an error. */
export function paginate<Item>(items: Item[], page: number, pageSize: number): Page<Item> {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    totalItems: items.length,
    totalPages: Math.ceil(items.length / pageSize),
  };
}

/** Whether the storage can be read (it may exist but throw). */
function storageReadable(storage: Storage | null): storage is Storage {
  if (!storage) return false;
  try {
    storage.getItem(MOCK_DB_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Whether the storage can really be written and read back (it may be full or blocked). */
function storageWritable(storage: Storage): boolean {
  const probe = `${MOCK_DB_KEY}.probe`;
  try {
    storage.setItem(probe, '1');
    const readBack = storage.getItem(probe) === '1';
    storage.removeItem(probe);
    return readBack;
  } catch {
    return false;
  }
}

/** Same match, same content (field by field, independent of key order). */
function sameRecord(a: MatchRecord, b: MatchRecord): boolean {
  return (
    a.matchId === b.matchId &&
    a.playerId === b.playerId &&
    a.playerName === b.playerName &&
    Date.parse(a.finishedAt) === Date.parse(b.finishedAt) &&
    a.score === b.score &&
    a.durationSeconds === b.durationSeconds &&
    a.endReason === b.endReason &&
    a.config.sessionSeconds === b.config.sessionSeconds &&
    a.config.spawnIntervalSeconds === b.config.spawnIntervalSeconds &&
    a.configKey === b.configKey
  );
}

/** `created`: stored now. `existing`: the same record was already there. */
export type UpsertOutcome =
  | { outcome: 'created' | 'existing'; record: MatchRecord }
  | { outcome: 'conflict'; record: MatchRecord };

/**
 * The mock API's data: the fixtures plus the matches registered on this device. It is kept
 * in local storage when it can be written. Otherwise it lives in memory: data already stored
 * is still read (e.g. storage full), but new records are lost on reload. A write that fails
 * later switches to memory too, and listeners are told.
 *
 * Every tab runs its own instance over the same storage, so while the data is stored each
 * read and write starts from what is stored now: one tab never writes an old list over
 * matches another tab registered. Storage has no atomic read-modify-write across tabs, so
 * two registrations at the very same moment can still race.
 */
export class MockDb {
  private currentPersistence: MockPersistence;
  private records: MatchRecord[];
  private readonly storage: Storage | null;
  private readonly fixtures: () => MatchRecord[];
  private readonly listeners = new Set<(persistence: MockPersistence) => void>();

  constructor(storage: Storage | null, fixtures: () => MatchRecord[] = fixtureRecords) {
    const readable = storageReadable(storage);
    this.storage = readable ? storage : null;
    this.currentPersistence = readable && storageWritable(storage) ? 'local' : 'memory';
    this.fixtures = fixtures;
    const stored = this.load();
    this.records = stored ?? this.fixtures();
    if (!stored) this.save();
  }

  get persistence(): MockPersistence {
    return this.currentPersistence;
  }

  /** Called whenever the persistence changes (a write failed after start-up). */
  onPersistenceChange(listener: (persistence: MockPersistence) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Registers a completed match, idempotently: the same record again returns the stored one,
   * a different record with an existing match id is a conflict (nothing is changed).
   */
  upsert(record: MatchRecord): UpsertOutcome {
    this.refresh();
    const existing = this.records.find((stored) => stored.matchId === record.matchId);
    if (existing) {
      return { outcome: sameRecord(existing, record) ? 'existing' : 'conflict', record: existing };
    }
    this.records.push(record);
    this.save();
    return { outcome: 'created', record };
  }

  /** Matches played with one configuration, ranked; `rank` is the position in that order. */
  ranking(configKey: string, page: number, pageSize: number): Page<RankingEntry> {
    this.refresh();
    const ranked = this.records
      .filter((record) => record.configKey === configKey)
      .sort(compareRanking)
      .map((record, index) => ({ ...record, rank: index + 1 }));
    return paginate(ranked, page, pageSize);
  }

  /** Matches of one player, most recent first. */
  playerMatches(playerId: string, page: number, pageSize: number): Page<MatchRecord> {
    this.refresh();
    const matches = this.records
      .filter((record) => record.playerId === playerId)
      .sort(compareHistory);
    return paginate(matches, page, pageSize);
  }

  /**
   * Picks up what other tabs stored. Only while the data is stored: in memory, this tab's
   * records may include matches storage never received.
   */
  private refresh(): void {
    if (this.currentPersistence !== 'local') return;
    const stored = this.load();
    if (stored) this.records = stored;
  }

  /** Unreadable or invalid stored data is ignored (the fixtures are used instead). */
  private load(): MatchRecord[] | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(MOCK_DB_KEY);
      if (raw === null) return null;
      const parsed = storedDbSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data.records : null;
    } catch {
      return null;
    }
  }

  /** A write that fails (e.g. storage full) keeps the data in memory, and says so. */
  private save(): void {
    if (!this.storage || this.currentPersistence === 'memory') return;
    try {
      this.storage.setItem(MOCK_DB_KEY, JSON.stringify({ records: this.records }));
    } catch {
      this.currentPersistence = 'memory';
      for (const listener of this.listeners) listener('memory');
    }
  }
}
