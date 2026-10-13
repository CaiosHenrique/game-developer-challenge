import { MutationObserver, type QueryClient } from '@tanstack/react-query';
import { markResultSubmitted } from '../storage/localStore.ts';
import type { PendingSubmissions } from '../storage/pendingSubmissions.ts';
import { submitMatch } from './client.ts';
import type { MatchRecord } from './contracts.ts';
import { ApiError } from './errors.ts';
import { refreshRecordQueries, retryDelay, shouldRetry } from './queries.ts';

/** Mutation keys: one per match, so each match has its own state. */
export const submissionKeys = {
  all: ['submitMatch'] as const,
  match: (matchId: string) => ['submitMatch', matchId] as const,
};

export type SubmitterOptions = {
  submit?: (record: MatchRecord) => Promise<MatchRecord>;
  markSubmitted?: (matchId: string, submittedAt: string) => 'updated' | 'not-current' | 'failed';
  now?: () => string;
  retryDelay?: (attempt: number) => number;
};

/**
 * Sends queued matches to the online ranking with TanStack Query mutations.
 *
 * Protocol: a record is queued (on this device) before it is sent, and only leaves the
 * queue after the server confirmed it AND this device recorded that confirmation on the
 * stored last result. If a local write fails, the record stays queued: a later trigger
 * sends it again (the server answers the same record idempotently) and retries the local
 * step. A match never has two sends in flight at once.
 */
export class MatchSubmitter {
  private readonly inFlight = new Set<string>();
  private readonly client: QueryClient;
  private readonly queue: PendingSubmissions;
  private readonly send: (record: MatchRecord) => Promise<MatchRecord>;
  private readonly markSubmitted: NonNullable<SubmitterOptions['markSubmitted']>;
  private readonly now: () => string;
  private readonly retryDelay: (attempt: number) => number;

  constructor(client: QueryClient, queue: PendingSubmissions, options: SubmitterOptions = {}) {
    this.client = client;
    this.queue = queue;
    this.send = options.submit ?? submitMatch;
    this.markSubmitted =
      options.markSubmitted ??
      ((matchId, submittedAt) => markResultSubmitted(matchId, submittedAt));
    this.now = options.now ?? (() => new Date().toISOString());
    this.retryDelay = options.retryDelay ?? retryDelay;
  }

  /** Sends every queued match that is not already in flight. */
  submitAll(): void {
    for (const record of this.queue.list()) void this.submit(record.matchId);
  }

  /** Sends one queued match. Resolves when this attempt is over (it never rejects). */
  async submit(matchId: string): Promise<void> {
    const record = this.queue.get(matchId);
    if (!record || this.inFlight.has(matchId)) return;
    if (this.confirmed(matchId)) {
      // Already confirmed in this session; only the local step is left to retry.
      this.finish(record);
      return;
    }
    this.inFlight.add(matchId);
    const observer = new MutationObserver<MatchRecord, unknown, MatchRecord>(this.client, {
      mutationKey: submissionKeys.match(matchId),
      mutationFn: this.send,
      retry: shouldRetry,
      retryDelay: this.retryDelay,
      // Offline is reported as a failure (Retry, or the `online` event), not paused.
      networkMode: 'always',
      // Keeps each match's last state for the interface.
      gcTime: Infinity,
    });
    try {
      await observer.mutate(record);
    } catch {
      return; // The failure is in the mutation state; the record stays queued.
    } finally {
      this.inFlight.delete(matchId);
    }
    this.finish(record);
    // Both tabs are asked again; a list still loading is asked anew (its request may have
    // been answered before the match was stored).
    refreshRecordQueries(this.client);
  }

  /** Whether the server confirmed this match during this session. */
  private confirmed(matchId: string): boolean {
    return this.client
      .getMutationCache()
      .findAll({ mutationKey: submissionKeys.match(matchId), exact: true })
      .some((mutation) => mutation.state.status === 'success');
  }

  /**
   * The server has the match: record it on the stored last result, then drop it from the
   * queue. A queue that is not stored has nothing to recover after a reload, so it is
   * always dropped.
   */
  private finish(record: MatchRecord): void {
    const marked = this.markSubmitted(record.matchId, this.now());
    if (marked === 'failed' && this.queue.persistent) return;
    this.queue.remove(record.matchId);
  }
}

/** The last submission attempt of a match, as kept by TanStack Query. */
export type SubmissionAttempt = {
  status: 'idle' | 'pending' | 'error' | 'success';
  error: unknown;
};

export type SubmissionStatus =
  'submitting' | 'waiting' | 'failed' | 'conflict' | 'submitted' | 'not-submitted';

export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'http' && error.status === 409;
}

/**
 * Where a match stands with the online ranking:
 * - `submitting`: a send is in flight;
 * - `submitted`: the server confirmed it (this session, or recorded on the stored result);
 * - `failed` / `conflict`: queued, and the last send failed (conflict: HTTP 409);
 * - `waiting`: queued, not sent yet in this session;
 * - `not-submitted`: neither queued nor confirmed (e.g. a result from before submissions).
 */
export function submissionStatus({
  queued,
  attempt,
  submittedAt,
}: {
  queued: boolean;
  attempt: SubmissionAttempt | undefined;
  submittedAt?: string | undefined;
}): SubmissionStatus {
  if (attempt?.status === 'pending') return 'submitting';
  if (attempt?.status === 'success' || submittedAt) return 'submitted';
  if (!queued) return 'not-submitted';
  if (attempt?.status === 'error') return isConflict(attempt.error) ? 'conflict' : 'failed';
  return 'waiting';
}

/**
 * Queued matches to list in the history: not those the server already confirmed in this
 * session, nor those already shown in the server's list (never the same match twice).
 */
export function visiblePending(
  queued: readonly MatchRecord[],
  attempts: ReadonlyMap<string, SubmissionAttempt>,
  serverMatchIds: ReadonlySet<string>,
): MatchRecord[] {
  return queued.filter(
    (record) =>
      attempts.get(record.matchId)?.status !== 'success' && !serverMatchIds.has(record.matchId),
  );
}
