import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  getAssetProgress,
  loadGameAssets,
  subscribeAssetProgress,
  type GameTextures,
} from '../game/assets.ts';
import { DEFAULT_GAME_CONFIG } from '../game/config.ts';
import { GameRuntime } from '../game/GameRuntime.ts';
import { HudStore, type MatchResult, type PauseReason } from '../game/hudStore.ts';
import { testManualClockFromQuery, testOptionsFromQuery } from '../game/scenarios.ts';
import { formatClock } from './format.ts';
import { Hud } from './Hud.tsx';

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; textures: GameTextures };

export function GameScreen({ onExit }: { onExit: () => void }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  /** A new key mounts a new match: new runtime, simulation, seed and config snapshot. */
  const [matchKey, setMatchKey] = useState(0);
  const progress = useSyncExternalStore(subscribeAssetProgress, getAssetProgress);

  useEffect(() => {
    let active = true;
    loadGameAssets().then(
      (textures) => active && setLoadState({ status: 'ready', textures }),
      () => active && setLoadState({ status: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = () => {
    setLoadState({ status: 'loading' });
    setAttempt((value) => value + 1);
  };

  return (
    <div className="game-screen">
      {loadState.status === 'ready' ? (
        <Match
          key={matchKey}
          textures={loadState.textures}
          onExit={onExit}
          onPlayAgain={() => setMatchKey((value) => value + 1)}
        />
      ) : (
        <div className="game-toolbar">
          <button type="button" onClick={onExit}>
            Main Menu
          </button>
        </div>
      )}

      {loadState.status === 'loading' && (
        <div className="game-message" role="status">
          <p>Loading assets… {Math.round(progress * 100)}%</p>
          <progress max={1} value={progress} aria-label="Asset loading progress" />
        </div>
      )}

      {loadState.status === 'error' && (
        <div className="game-message" role="alert">
          <p>Failed to load the game assets. Check your connection and try again.</p>
          <button type="button" onClick={retry}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

function Match({
  textures,
  onExit,
  onPlayAgain,
}: {
  textures: GameTextures;
  onExit: () => void;
  onPlayAgain: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const [failed, setFailed] = useState(false);
  const [store] = useState(() => new HudStore(GameRuntime.initialHud(DEFAULT_GAME_CONFIG)));
  const hud = useSyncExternalStore(store.subscribe, store.getSnapshot);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const debugColliders = new URLSearchParams(window.location.search).get('debug') === 'colliders';
    const runtime = new GameRuntime(host, textures, DEFAULT_GAME_CONFIG, store, {
      debugColliders,
      simulation: testOptionsFromQuery(window.location.search),
      manualClock: testManualClockFromQuery(window.location.search),
    });
    runtimeRef.current = runtime;
    runtime.start().catch(() => {
      runtime.destroy();
      setFailed(true);
    });
    return () => {
      runtime.destroy();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [textures, store]);

  return (
    <>
      <div ref={hostRef} className="game-host" data-testid="game-host" />
      <Hud hud={hud} onPause={() => runtimeRef.current?.pause('manual')} />
      {/* Discrete events only (score, time warnings, pause, low health, match end). */}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {hud.announcement}
      </div>
      {hud.result ? (
        <EndPanel result={hud.result} onPlayAgain={onPlayAgain} onMainMenu={onExit} />
      ) : hud.pauseReason ? (
        <PauseDialog
          reason={hud.pauseReason}
          onResume={() => runtimeRef.current?.resume()}
          onMainMenu={onExit}
        />
      ) : (
        <div className="game-toolbar">
          <button type="button" onClick={onExit}>
            Main Menu
          </button>
        </div>
      )}
      {failed && (
        <div className="game-message" role="alert">
          <p>The game could not start. Reload the page to try again.</p>
        </div>
      )}
    </>
  );
}

/** Provisional end-of-match panel (the full Result screen comes with the menus). */
function EndPanel({
  result,
  onPlayAgain,
  onMainMenu,
}: {
  result: MatchResult;
  onPlayAgain: () => void;
  onMainMenu: () => void;
}) {
  const playAgainRef = useRef<HTMLButtonElement>(null);
  useEffect(() => playAgainRef.current?.focus(), []);

  return (
    <div className="end-backdrop">
      <section
        className="end-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-title"
        data-testid="end-panel"
      >
        <h2 id="end-title">{result.reason === 'time' ? 'Battle Complete' : 'Your Ship Sank'}</h2>
        <p className="end-score" data-testid="end-score">
          {result.score}
        </p>
        <p className="end-details">
          Points · <span data-testid="end-time">{formatClock(result.timePlayedSeconds)}</span> ·{' '}
          {result.reason === 'time' ? 'Time up' : 'Ship sunk'}
        </p>
        <div className="end-actions">
          <button ref={playAgainRef} type="button" onClick={onPlayAgain}>
            Play Again
          </button>
          <button type="button" onClick={onMainMenu}>
            Main Menu
          </button>
        </div>
      </section>
    </div>
  );
}

const PAUSE_MESSAGES: Record<PauseReason, string> = {
  manual: 'The battle is on hold.',
  blur: 'Paused because the game window lost focus.',
  hidden: 'Paused because the page was hidden.',
};

/** Keeps Tab and Shift+Tab within the dialog's buttons. */
function trapFocus(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Pause dialog: only a player action (Resume, P or Esc) resumes the match. */
function PauseDialog({
  reason,
  onResume,
  onMainMenu,
}: {
  reason: PauseReason;
  onResume: () => void;
  onMainMenu: () => void;
}) {
  const resumeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => resumeRef.current?.focus(), []);

  return (
    <div className="end-backdrop">
      <section
        className="end-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-title"
        aria-describedby="pause-reason"
        onKeyDown={trapFocus}
      >
        <h2 id="pause-title">Paused</h2>
        <p id="pause-reason" className="end-details">
          {PAUSE_MESSAGES[reason]}
        </p>
        <p className="pause-hint">Press P or Esc to resume.</p>
        <div className="end-actions">
          <button ref={resumeRef} type="button" onClick={onResume}>
            Resume
          </button>
          <button type="button" onClick={onMainMenu}>
            Main Menu
          </button>
        </div>
      </section>
    </div>
  );
}
