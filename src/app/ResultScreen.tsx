import { useEffect, useRef, useState } from 'react';
import { matchRecordFrom } from '../api/matchRecord.ts';
import { submissionStatus } from '../api/submissions.ts';
import {
  loadLastResult,
  loadLastResultExact,
  type Player,
  type StoredResult,
} from '../storage/localStore.ts';
import { formatClock } from './format.ts';
import { submissionLabel } from './submissionText.ts';
import { useSubmissions } from './useSubmissions.ts';

/** The latest match completed in this tab, and whether storing it succeeded. */
export type SessionResult = { record: StoredResult; saved: boolean };

/**
 * Last completed match: the match from this session if there is one (shown even when it
 * could not be stored), otherwise the one stored on this device. A result that is neither
 * confirmed by the online ranking nor queued (its queue was lost, or it predates
 * submissions) can be submitted from here, rebuilt from the result exactly as recorded.
 */
export function ResultScreen({
  sessionResult,
  player,
  onPlayAgain,
  onMainMenu,
}: {
  sessionResult: SessionResult | null;
  player: Player;
  onPlayAgain: () => void;
  onMainMenu: () => void;
}) {
  const [stored] = useState(() => loadLastResult());
  const [storedExact] = useState(() => loadLastResultExact());
  const result = sessionResult?.record ?? stored;
  const saved = sessionResult ? sessionResult.saved : stored !== null;
  const playAgainRef = useRef<HTMLButtonElement>(null);
  useEffect(() => playAgainRef.current?.focus(), []);

  const { queue, queued, attempts, submitter, persistent } = useSubmissions();
  const isQueued = result !== null && queued.some((record) => record.matchId === result.matchId);
  const attempt = result ? attempts.get(result.matchId) : undefined;
  const submission = submissionStatus({
    queued: isQueued,
    attempt,
    submittedAt: result?.submittedAt,
  });
  const exact = sessionResult?.record ?? storedExact;
  const recoverable =
    submission === 'not-submitted' && exact && exact.matchId === result?.matchId
      ? matchRecordFrom(exact, player)
      : null;
  const submitRecovered = () => {
    if (!recoverable) return;
    queue.add(recoverable); // queued before it is sent, like any finished match
    void submitter.submit(recoverable.matchId);
  };

  return (
    <main className="menu-screen">
      <section className="menu-panel result-panel" aria-labelledby="result-title">
        {result ? (
          <>
            <h1 id="result-title" className="menu-heading">
              {result.reason === 'time' ? 'Battle Complete' : 'Your Ship Sank'}
            </h1>
            <p className="result-score" data-testid="result-score">
              {result.score}
            </p>
            <p className="result-details">
              Points ·{' '}
              <span data-testid="result-time">{formatClock(result.timePlayedSeconds)}</span> ·{' '}
              <span data-testid="result-reason">
                {result.reason === 'time' ? 'Time up' : 'Ship sunk'}
              </span>
            </p>
            <dl className="result-status">
              <div>
                <dt>Saved on this device</dt>
                <dd data-testid="result-saved">
                  {saved ? 'Yes' : 'No — kept for this session only'}
                </dd>
              </div>
              <div>
                <dt>Online ranking</dt>
                <dd>
                  <span data-testid="result-registration" role="status">
                    {submissionLabel(submission, attempt?.error)}
                  </span>
                  {recoverable && (
                    <button
                      type="button"
                      className="records-button result-retry"
                      onClick={submitRecovered}
                    >
                      Submit
                    </button>
                  )}
                  {(submission === 'failed' || submission === 'conflict') && (
                    <button
                      type="button"
                      className="records-button result-retry"
                      onClick={() => void submitter.submit(result.matchId)}
                    >
                      Retry
                    </button>
                  )}
                </dd>
              </div>
            </dl>
            {isQueued && !persistent && submission !== 'submitted' && (
              <p className="form-error">
                This device cannot keep the submission queue: if you reload before it is submitted,
                this result will not reach the online ranking.
              </p>
            )}
            {!saved && (
              <p className="form-error" role="alert">
                This result could not be saved on this device (storage is unavailable). It will be
                lost when you leave or reload the page.
              </p>
            )}
          </>
        ) : (
          <>
            <h1 id="result-title" className="menu-heading">
              No battle yet
            </h1>
            <p className="result-details">Finish a battle to see its result here.</p>
          </>
        )}
        <div className="menu-actions">
          <button ref={playAgainRef} type="button" className="menu-button" onClick={onPlayAgain}>
            {result ? 'Play Again' : 'Play'}
          </button>
          <button type="button" className="menu-button" onClick={onMainMenu}>
            Main Menu
          </button>
        </div>
      </section>
    </main>
  );
}
