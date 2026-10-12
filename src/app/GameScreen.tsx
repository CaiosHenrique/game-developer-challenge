import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getAssetProgress,
  loadGameAssets,
  subscribeAssetProgress,
  type GameTextures,
} from '../game/assets.ts';
import { DEFAULT_GAME_CONFIG } from '../game/config.ts';
import { GameRuntime } from '../game/GameRuntime.ts';

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; textures: GameTextures };

export function GameScreen({ onExit }: { onExit: () => void }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
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
      {loadState.status === 'ready' && <GameCanvas textures={loadState.textures} />}

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

      <div className="game-toolbar">
        <button type="button" onClick={onExit}>
          Main Menu
        </button>
      </div>
    </div>
  );
}

function GameCanvas({ textures }: { textures: GameTextures }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const debugColliders = new URLSearchParams(window.location.search).get('debug') === 'colliders';
    const runtime = new GameRuntime(host, textures, DEFAULT_GAME_CONFIG, { debugColliders });
    runtime.start().catch(() => {
      runtime.destroy();
      setFailed(true);
    });
    return () => runtime.destroy();
  }, [textures]);

  return (
    <>
      <div ref={hostRef} className="game-host" data-testid="game-host" />
      {failed && (
        <div className="game-message" role="alert">
          <p>The game could not start. Reload the page to try again.</p>
        </div>
      )}
    </>
  );
}
