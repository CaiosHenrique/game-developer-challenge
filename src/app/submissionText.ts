import { ApiError } from '../api/errors.ts';
import type { SubmissionStatus } from '../api/submissions.ts';

/** What the player reads about a match's submission to the online ranking. */
export function submissionLabel(status: SubmissionStatus, error: unknown): string {
  switch (status) {
    case 'submitting':
      return 'Submitting…';
    case 'waiting':
      return 'Waiting to submit';
    case 'failed':
      return `Not submitted yet: ${error instanceof ApiError ? error.message : 'something went wrong.'}`;
    case 'conflict':
      return 'Conflict: the online ranking holds a different record for this match.';
    case 'submitted':
      return 'Submitted';
    case 'not-submitted':
      return 'Not submitted';
  }
}
