import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getAssetProgress,
  loadGameAssets,
  subscribeAssetProgress,
  type GameTextures,
} from '../game/assets.ts';
import { DEFAULT_GAME_CONFIG } from '../game/config.ts';
import { GameRuntime } from '../game/GameRuntime.ts';
import { HudStore, type MatchResult } from '../game/hudStore.ts';
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
    runtime.start().catch(() => {
      runtime.destroy();
      setFailed(true);
    });
    return () => runtime.destroy();
  }, [textures, store]);

  return (
    <>
      <div ref={hostRef} className="game-host" data-testid="game-host" />
      <Hud hud={hud} />
      {hud.result ? (
        <EndPanel result={hud.result} onPlayAgain={onPlayAgain} onMainMenu={onExit} />
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
