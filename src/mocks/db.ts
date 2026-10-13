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

/** Whether the storage can really be written and read back (it may exist but throw). */
function storageWorks(storage: Storage | null): storage is Storage {
  if (!storage) return false;
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

/**
 * The mock API's data: the fixtures plus the matches registered on this device. It is kept
 * in local storage, or only in memory when storage is unavailable (then it starts from the
 * fixtures again after every reload).
 */
export class MockDb {
  readonly persistence: MockPersistence;
  private records: MatchRecord[];
  private readonly storage: Storage | null;
  private readonly fixtures: () => MatchRecord[];

  constructor(storage: Storage | null, fixtures: () => MatchRecord[] = fixtureRecords) {
    this.storage = storageWorks(storage) ? storage : null;
    this.persistence = this.storage ? 'local' : 'memory';
    this.fixtures = fixtures;
    const stored = this.load();
    this.records = stored ?? this.fixtures();
    if (!stored) this.save();
  }

  /** Matches played with one configuration, ranked; `rank` is the position in that order. */
  ranking(configKey: string, page: number, pageSize: number): Page<RankingEntry> {
    const ranked = this.records
      .filter((record) => record.configKey === configKey)
      .sort(compareRanking)
      .map((record, index) => ({ ...record, rank: index + 1 }));
    return paginate(ranked, page, pageSize);
  }

  /** Matches of one player, most recent first. */
  playerMatches(playerId: string, page: number, pageSize: number): Page<MatchRecord> {
    const matches = this.records
      .filter((record) => record.playerId === playerId)
      .sort(compareHistory);
    return paginate(matches, page, pageSize);
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

  /** Best effort: a write that fails (e.g. storage full) keeps the data in memory. */
  private save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(MOCK_DB_KEY, JSON.stringify({ records: this.records }));
    } catch {
      // Still served from memory for this page load.
    }
  }
}
