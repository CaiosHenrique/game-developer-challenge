import { z } from 'zod';
import { matchRecordSchema, type MatchRecord } from '../api/contracts.ts';
import { browserStorage, STORAGE_KEYS } from './localStore.ts';

const storedQueueSchema = z.array(z.unknown());

/**
 * Completed matches not yet confirmed by the online ranking, kept until the server confirms
 * them (in submission order). Stored on this device so they survive a reload; when storage
 * is unavailable or a write fails, the queue lives in memory and `persistent` is false (it
 * will not survive a reload). Observable for React (`subscribe` / `list`).
 *
 * Other tabs share the stored queue, so every change starts from what is stored now, not
 * from this tab's copy: a tab never writes back an old list over another tab's matches.
 * Storage offers no atomic read-modify-write across tabs, so two tabs changing the queue at
 * the very same moment can still race; a match sent twice is harmless (the server is
 * idempotent).
 */
export class PendingSubmissions {
  private records: MatchRecord[];
  private stored: boolean;
  private readonly storage: Storage | null;
  private readonly listeners = new Set<() => void>();

  constructor(storage: Storage | null = browserStorage()) {
    this.storage = storage;
    const loaded = this.read();
    this.records = loaded ?? [];
    this.stored = loaded !== null;
  }

  /** Whether the queue as it is now would survive a reload. */
  get persistent(): boolean {
    return this.stored;
  }

  /** The queued records (a new array after every change, the same one otherwise). */
  readonly list = (): readonly MatchRecord[] => this.records;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get(matchId: string): MatchRecord | undefined {
    return this.records.find((record) => record.matchId === matchId);
  }

  /** Re-reads the stored queue (e.g. another tab changed it). */
  refresh(): void {
    this.set(this.latest());
  }

  /** Queues a record, once per match id. Returns whether it is stored on this device. */
  add(record: MatchRecord): boolean {
    const latest = this.latest();
    if (latest.some((queued) => queued.matchId === record.matchId)) {
      this.set(latest);
      return this.stored;
    }
    const next = [...latest, record];
    if (this.stored && !this.write(next)) this.stored = false;
    this.set(next);
    return this.stored;
  }

  /**
   * Removes a record. Returns false when the removal could not be stored: the record then
   * stays queued (in memory and storage alike), so it is sent again later instead of lost.
   */
  remove(matchId: string): boolean {
    const latest = this.latest();
    if (!latest.some((record) => record.matchId === matchId)) {
      this.set(latest);
      return true;
    }
    const next = latest.filter((record) => record.matchId !== matchId);
    if (this.stored && !this.write(next)) {
      this.set(latest);
      return false;
    }
    this.set(next);
    return true;
  }

  /** What is stored now while the queue is stored; this tab's copy otherwise. */
  private latest(): MatchRecord[] {
    if (!this.stored) return this.records;
    return this.read() ?? this.records;
  }

  /** Replaces this tab's copy, telling listeners only when the queue really changed. */
  private set(next: MatchRecord[]): void {
    const same =
      next.length === this.records.length &&
      next.every((record, index) => record.matchId === this.records[index]?.matchId);
    if (same) return;
    this.records = next;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** The stored queue (invalid entries dropped), or null when storage cannot be read. */
  private read(): MatchRecord[] | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(STORAGE_KEYS.pendingMatches);
      const parsed = storedQueueSchema.safeParse(raw === null ? [] : JSON.parse(raw));
      if (!parsed.success) return [];
      return parsed.data.flatMap((entry) => {
        const record = matchRecordSchema.safeParse(entry);
        return record.success ? [record.data] : [];
      });
    } catch (error) {
      return error instanceof SyntaxError ? [] : null;
    }
  }

  private write(records: MatchRecord[]): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(STORAGE_KEYS.pendingMatches, JSON.stringify(records));
      return true;
    } catch {
      return false;
    }
  }
}
