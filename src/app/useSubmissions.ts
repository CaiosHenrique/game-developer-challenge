import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { useMutationState } from '@tanstack/react-query';
import type { MatchRecord } from '../api/contracts.ts';
import { submissionKeys, type MatchSubmitter, type SubmissionAttempt } from '../api/submissions.ts';
import type { PendingSubmissions } from '../storage/pendingSubmissions.ts';

export type Submissions = { queue: PendingSubmissions; submitter: MatchSubmitter };

export const SubmissionsContext = createContext<Submissions | null>(null);

/**
 * The submission queue and the last attempt of each match (from TanStack Query's mutation
 * cache), kept up to date for the interface.
 */
export function useSubmissions() {
  const context = useContext(SubmissionsContext);
  if (!context) throw new Error('useSubmissions needs a SubmissionsContext provider');
  const { queue, submitter } = context;
  const queued = useSyncExternalStore(queue.subscribe, queue.list);
  const states = useMutationState({
    filters: { mutationKey: submissionKeys.all },
    select: (mutation) => ({
      matchId: (mutation.state.variables as MatchRecord | undefined)?.matchId,
      status: mutation.state.status,
      error: mutation.state.error,
    }),
  });
  // Mutations are listed oldest first: the last one of a match is its latest attempt.
  const attempts = useMemo(() => {
    const latest = new Map<string, SubmissionAttempt>();
    for (const { matchId, status, error } of states) {
      if (matchId) latest.set(matchId, { status, error });
    }
    return latest;
  }, [states]);
  return { queue, queued, attempts, submitter, persistent: queue.persistent };
}
