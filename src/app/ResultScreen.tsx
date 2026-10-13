import { useEffect, useRef, useState } from 'react';
import { loadLastResult, type StoredResult } from '../storage/localStore.ts';
import { formatClock } from './format.ts';

/** The latest match completed in this tab, and whether storing it succeeded. */
export type SessionResult = { record: StoredResult; saved: boolean };

/**
 * Last completed match. It only reads: the match from this session if there is one
 * (shown even when it could not be stored), otherwise the one stored on this device.
 */
export function ResultScreen({
  sessionResult,
  onPlayAgain,
  onMainMenu,
}: {
  sessionResult: SessionResult | null;
  onPlayAgain: () => void;
  onMainMenu: () => void;
}) {
  const [stored] = useState(() => loadLastResult());
  const result = sessionResult?.record ?? stored;
  const saved = sessionResult ? sessionResult.saved : stored !== null;
  const playAgainRef = useRef<HTMLButtonElement>(null);
  useEffect(() => playAgainRef.current?.focus(), []);

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
                <dd data-testid="result-registration">Not submitted</dd>
              </div>
            </dl>
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
